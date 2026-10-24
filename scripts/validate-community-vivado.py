"""Exercise the pinned community MCP against local evidence and an owned Vivado session."""
import asyncio
import hashlib
import json
import os
from pathlib import Path
import sys
import time
from datetime import datetime, timezone

from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

ROOT = Path(__file__).resolve().parents[1]
STAMP = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
OUT = ROOT / 'artifacts' / ('community-vivado-validation-' + STAMP)
OUT.mkdir()
RECEIPT = {'started_at': datetime.now(timezone.utc).isoformat(),
           'model_api_calls': 0, 'checks': [], 'scope': 'Community MCP integration; no new design benchmark score.'}


def save():
    (OUT / 'result.json').write_text(json.dumps(RECEIPT, indent=2, ensure_ascii=False), encoding='utf-8')


async def main():
    params = StdioServerParameters(command=sys.executable, args=['-m', 'vivado_mcp'],
                                  cwd=str(OUT), env={'VIVADO_PATH': 'E:/Xilinx/Vivado/2020.2/bin/vivado.bat',
                                                     'PYTHONUTF8': '1'})
    with (OUT / 'server-stderr.log').open('w', encoding='utf-8') as stderr:
        async with stdio_client(params, errlog=stderr) as streams:
            async with ClientSession(*streams, read_timeout_seconds=180) as client:
                await client.initialize()
                tools = (await client.list_tools()).tools
                prompts = (await client.list_prompts()).prompts
                RECEIPT['tool_count'] = len(tools)
                RECEIPT['prompt_count'] = len(prompts)
                (OUT / 'tools.json').write_text(json.dumps([t.model_dump(mode='json') for t in tools], indent=2, ensure_ascii=False), encoding='utf-8')
                assert len(tools) == 32, len(tools)
                assert len(prompts) == 11, len(prompts)
                print(f'Discovered {len(tools)} tools and {len(prompts)} prompts', flush=True)

                async def call(label, name, arguments, verify, decode=False):
                    start = time.monotonic()
                    row = {'label': label, 'tool': name, 'arguments': arguments}
                    RECEIPT['checks'].append(row)
                    save()
                    response = await client.call_tool(name, arguments)
                    text = '\n'.join(b.text for b in response.content if b.type == 'text')
                    (OUT / (label + '.txt')).write_text(text, encoding='utf-8')
                    row['mcp_is_error'] = response.is_error
                    row['duration_ms'] = round((time.monotonic() - start) * 1000)
                    try:
                        data = json.loads(text) if decode else text
                        row['passed'] = not response.is_error and bool(verify(data))
                    except Exception as exc:
                        row['passed'] = False
                        row['verification_error'] = str(exc)
                    save()
                    print(('PASS ' if row['passed'] else 'FAIL ') + label, flush=True)
                    if not row['passed']:
                        raise RuntimeError(f'{label} failed; see {OUT}')
                    return data

                timing = ROOT / 'artifacts/2026-10-24T07-42-04-300Z-eda_vivado_implement-c8f771c6/timing.rpt'
                cdc = ROOT / 'artifacts/2026-10-24T07-42-50-020Z-eda_vivado_reports-c6e0029a/cdc.rpt'
                dcp = ROOT / 'artifacts/2026-10-24T07-42-04-300Z-eda_vivado_implement-c8f771c6/routed.dcp'
                wave = ROOT / 'artifacts/2026-10-22T16-59-02-066Z-xsim-961b80a0/wave.vcd'
                RECEIPT['inputs'] = [{'path': str(p), 'sha256': hashlib.sha256(p.read_bytes()).hexdigest()} for p in (timing, cdc, dcp, wave)]
                await call('offline-axi-timing', 'get_timing_report', {'report_file': str(timing), 'output_format': 'json'},
                           lambda v: v['metrics']['setup']['worst_slack_ns'] == 2.393 and v['verdict']['signoff'] is False, True)
                await call('offline-ethernet-cdc', 'get_cdc_report', {'report_file': str(cdc), 'max_details': 5},
                           lambda v: v['summary']['by_severity'].get('Warning') == 34 and v['verdict']['signoff'] is False, True)
                await call('real-xsim-vcd', 'query_waveform', {'file_path': str(wave), 'max_events': 12},
                           lambda v: v.get('success') is True and v['simulation_verdict'] == 'not_evaluated', True)
                sid = 'community-review-' + STAMP
                try:
                    await call('start-owned-session', 'start_session', {'session_id': sid, 'mode': 'tcl', 'timeout': 60},
                               lambda v: '[ERROR]' not in v and '2020.2' in v)
                    await call('persistent-state-set', 'run_tcl', {'session_id': sid, 'command': 'set EDA_REVIEW_STATE 731; puts "EDA_STATE=$EDA_REVIEW_STATE"'},
                               lambda v: '[ERROR]' not in v and 'EDA_STATE=731' in v)
                    await call('persistent-state-read', 'run_tcl', {'session_id': sid, 'command': 'puts "EDA_STATE=$EDA_REVIEW_STATE"'},
                               lambda v: '[ERROR]' not in v and 'EDA_STATE=731' in v)
                    await call('open-existing-routed-dcp', 'run_tcl', {'session_id': sid, 'command': 'open_checkpoint {' + dcp.as_posix() + '}; puts EDA_CHECKPOINT_OPEN', 'timeout': 120},
                               lambda v: '[ERROR]' not in v and 'EDA_CHECKPOINT_OPEN' in v)
                    live = await call('live-axi-timing', 'get_timing_report', {'session_id': sid, 'output_format': 'json'},
                                      lambda v: v['metrics']['setup']['worst_slack_ns'] == 2.393 and v['verdict']['signoff'] is False, True)
                    baseline = OUT / 'baseline-timing.json'
                    baseline.write_text(json.dumps(live), encoding='utf-8')
                    await call('live-timing-baseline', 'get_timing_report', {'session_id': sid, 'output_format': 'json', 'baseline_file': str(baseline)},
                               lambda v: 'comparison' in v and v['metrics']['setup']['worst_slack_ns'] == 2.393, True)
                    await call('negative-tcl-error', 'run_tcl', {'session_id': sid, 'command': 'error EDA_EXPECTED_NEGATIVE'},
                               lambda v: 'EDA_EXPECTED_NEGATIVE' in v and ('ERROR' in v or 'rc=1' in v))
                    await call('session-after-error', 'run_tcl', {'session_id': sid, 'command': 'puts "EDA_STATE=$EDA_REVIEW_STATE"'},
                               lambda v: '[ERROR]' not in v and 'EDA_STATE=731' in v)
                finally:
                    await call('stop-owned-session', 'stop_session', {'session_id': sid}, lambda v: '[ERROR]' not in v)
                await call('all-owned-sessions-closed', 'list_sessions', {}, lambda v: 'community-review-' not in v)
                RECEIPT['passed'] = all(c.get('passed') for c in RECEIPT['checks'])


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as exc:
        RECEIPT['passed'] = False
        RECEIPT['error'] = f'{type(exc).__name__}: {exc}'
        raise
    finally:
        RECEIPT['finished_at'] = datetime.now(timezone.utc).isoformat()
        save()
        print(str(OUT), flush=True)
