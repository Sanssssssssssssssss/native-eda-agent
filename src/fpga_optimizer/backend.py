"""Owned local stdio MCP session; fixed Tcl recipes, no remote/model clients."""
import asyncio
from contextlib import AsyncExitStack, nullcontext
import hashlib
import json
import os
from pathlib import Path
import re
import sys

from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client
from vivado_mcp.vivado.tcl_utils import tcl_quote
from .core import ROOT, PLAYS, parse_reports, is_timeout_failure


def q(value):
    return tcl_quote(str(value).replace('\\', '/'))


class LocalVivado:
    def __init__(self, directory, executable):
        self.directory = Path(directory)
        self.executable = executable
        self.sid = 'optimizer-' + self.directory.name
        self.stack = AsyncExitStack()
        self.engine_pid = None
        self.timed_out = False
        self.trace = None

    async def __aenter__(self):
        self.stderr = self.stack.enter_context((self.directory / 'mcp-stderr.log').open('w', encoding='utf-8'))
        params = StdioServerParameters(command=sys.executable, args=[str(ROOT / 'src/vivado_workbench.py')],
            cwd=str(self.directory), env={'VIVADO_PATH': self.executable, 'PYTHONUTF8': '1'})
        try:
            streams = await self.stack.enter_async_context(stdio_client(params, errlog=self.stderr))
            self.client = await self.stack.enter_async_context(ClientSession(*streams, read_timeout_seconds=3700))
            await self.client.initialize()
            await self.call('start_session', {'session_id': self.sid, 'mode': 'tcl', 'timeout': 60}, self.directory / 'session-start.log')
            text = await self.call('run_tcl', {'session_id': self.sid, 'command': 'set_param general.maxThreads 2; puts "EDA_OWNED_PID=[pid]"'}, self.directory / 'engine-pid.log')
            self.engine_pid = int(re.search(r'EDA_OWNED_PID=(\d+)', text)[1])
            return self
        except BaseException as exc:
            await self.__aexit__(type(exc), exc, exc.__traceback__)
            raise

    async def call(self, name, args, log):
        # Raw commands/results stay in local evidence; the timeline keeps metadata.
        scope = self.trace.span('mcp_call', tool=name, argument_keys=sorted(args),
                                arguments_sha256=hashlib.sha256(json.dumps(args, sort_keys=True).encode()).hexdigest(),
                                timeout_seconds=args.get('timeout')) if self.trace else nullcontext()
        with scope:
            try:
                response = await self.client.call_tool(name, args)
                text = '\n'.join(b.text for b in response.content if b.type == 'text')
                Path(log).write_text(text, encoding='utf-8')
                if response.is_error or '[ERROR]' in text:
                    raise RuntimeError(text[-1800:])
                return text
            except BaseException as exc:
                if isinstance(exc, (TimeoutError, asyncio.CancelledError)) or is_timeout_failure(str(exc)):
                    self.timed_out = True
                if not Path(log).exists():
                    Path(log).write_text(f'{type(exc).__name__}: {exc}', encoding='utf-8')
                raise
            finally:
                if self.trace and Path(log).exists():
                    self.trace.evidence(log, 'mcp_response')

    async def __aexit__(self, exc_type, exc, tb):
        errors = []
        try:
            if self.timed_out and self.engine_pid:
                # Only the engine PID reported by the session created here.
                # A tool timeout alone does not stop Vivado; explicitly end it.
                if os.name == 'nt':
                    process = await asyncio.create_subprocess_exec('taskkill', '/PID', str(self.engine_pid), '/T', '/F',
                        stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.STDOUT,
                        creationflags=0x08000000)
                    output, _ = await process.communicate()
                    (self.directory / 'timeout-cleanup.log').write_bytes(output)
                else:
                    import signal
                    os.kill(self.engine_pid, signal.SIGTERM)
            await self.call('stop_session', {'session_id': self.sid}, self.directory / 'session-stop.log')
        except Exception as cleanup_error:
            errors.append(f'{type(cleanup_error).__name__}: {cleanup_error}')
        finally:
            try:
                await self.stack.aclose()
            except Exception as cleanup_error:
                errors.append(f'{type(cleanup_error).__name__}: {cleanup_error}')
            if self.trace:
                self.trace.event('session_cleanup', status='failed' if errors else 'completed',
                                 error_count=len(errors), owned_engine_pid=self.engine_pid)
            if errors:
                log = self.directory / 'cleanup-errors.log'
                log.write_text('\n'.join(errors), encoding='utf-8')
                if self.trace:
                    self.trace.evidence(log, 'cleanup_errors')
                # Keep the original failure when cleanup also fails.
                if exc is None:
                    raise RuntimeError('Session cleanup failed; inspect cleanup-errors.log')

    async def measure(self, checkpoint, directory, play=None, timeout=180):
        directory = Path(directory)
        directory.mkdir(exist_ok=True)
        helper = ROOT / 'src/tools/vivado-common.tcl'
        commands = PLAYS[play]['commands'] if play else []
        script = f'''source {q(helper)}
if {{[llength [get_projects -quiet]]}} {{close_project}}
cd {q(directory)}
open_checkpoint {q(checkpoint)}
set_param general.maxThreads 2
''' + '\n'.join(commands) + '''
eda::reports [list timing utilization route drc] optimizer
write_xdc -force -type timing timing.xdc
write_verilog -force -mode funcsim netlist.v
set fields [dict create part [eda::str [get_property PART [current_design]]] cell_count [llength [get_cells -hier -quiet -filter {IS_PRIMITIVE == 1}]] lut_count [llength [get_cells -hier -quiet -filter {REF_NAME =~ LUT*}]] drc_errors [llength [get_drc_violations -quiet -filter {SEVERITY == Error}]] drc_critical [llength [get_drc_violations -quiet -filter {SEVERITY == "Critical Warning"}]]]
set ports {}
foreach p [lsort [get_ports -quiet]] {lappend ports [eda::obj [dict create name [eda::str $p] direction [eda::str [get_property DIRECTION $p]]]]}
dict set fields ports [eda::arr $ports]
set clocks {}
foreach c [lsort [get_clocks -quiet]] {lappend clocks [eda::obj [dict create name [eda::str $c] period_ns [eda::num [get_property PERIOD $c]]]]}
dict set fields clocks [eda::arr $clocks]
set f [open optimizer-metrics.json w]; puts $f [eda::obj $fields]; close $f
'''
        if play:
            script += 'write_checkpoint -force design.dcp\n'
        script += 'set done [open measurement-complete.txt w]; puts $done EDA_OPTIMIZER_MEASURE_COMPLETE; close $done\nputs EDA_OPTIMIZER_MEASURE_COMPLETE\n'
        (directory / 'operation.tcl').write_text(script, encoding='utf-8')
        if self.trace:
            self.trace.evidence(directory / 'operation.tcl', 'generated_tcl')
        # MCP responses are bounded upstream; complete reports are separate
        # files, and a fresh completion receipt avoids relying on a clipped tail.
        command = f'source {q(directory / "operation.tcl")}'
        text = await self.call('run_tcl', {'session_id': self.sid, 'command': command, 'timeout': max(1, int(timeout))}, directory / 'mcp-response.log')
        if (directory / 'measurement-complete.txt').read_text(encoding='utf-8').strip() != 'EDA_OPTIMIZER_MEASURE_COMPLETE':
            raise RuntimeError('Missing measurement completion marker')
        metrics = json.loads((directory / 'optimizer-metrics.json').read_text(encoding='utf-8'))
        metrics['interface_fingerprint'] = hashlib.sha256(json.dumps(metrics['ports'], sort_keys=True).encode()).hexdigest()
        metrics.update(parse_reports(directory))
        return metrics, directory / 'design.dcp' if play else Path(checkpoint)
