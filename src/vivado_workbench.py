"""Local project/IP/Block Design extension of the pinned community Vivado MCP.

Uses the upstream session manager; no model clients. Upstream source stays intact.
Each new tool records arguments, generated Tcl, raw output and a result receipt.
"""
import functools
import hashlib
import inspect
import json
from contextvars import ContextVar
from datetime import datetime, timezone
from pathlib import Path
import re
import time
import uuid

from mcp.server.mcpserver import Context
from vivado_mcp.server import mcp, _require_session
from vivado_mcp.vivado.tcl_utils import tcl_quote

ROOT = Path(__file__).resolve().parents[1]
CALL = ContextVar('workbench_call')


def q(value):
    value = str(value)
    if any(ord(c) < 32 for c in value):
        raise ValueError('Control characters are not accepted in Tcl arguments')
    return tcl_quote(value)


def identifier(value):
    if not re.fullmatch(r'[A-Za-z][A-Za-z0-9_]*', value):
        raise ValueError(f'Expected a simple Vivado identifier: {value!r}')
    return q(value)


def location(value, exists=False):
    path = Path(value)
    if not path.is_absolute():
        raise ValueError('Use an absolute path')
    path = path.resolve()
    if not path.is_relative_to(ROOT):
        raise ValueError(f'Workbench paths must be within {ROOT}')
    if exists and not path.exists():
        raise ValueError(f'Path does not exist: {path}')
    q(path.as_posix())
    return path


def files(values):
    paths = [location(v, exists=True) for v in values]
    for path in paths:
        if not path.is_file():
            raise ValueError(f'Not a file: {path}')
        CALL.get()['inputs'].append({'path': str(path), 'sha256': hashlib.sha256(path.read_bytes()).hexdigest()})
    return '[list ' + ' '.join(q(p.as_posix()) for p in paths) + ']'


def logged(fn):
    @functools.wraps(fn)
    async def wrapper(*args, **kwargs):
        arguments = dict(inspect.signature(fn).bind(*args, **kwargs).arguments)
        arguments.pop('ctx', None)
        stamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
        out = ROOT / 'artifacts' / f'vivado-workbench-{stamp}-{fn.__name__}-{uuid.uuid4().hex[:6]}'
        out.mkdir(parents=True)
        receipt = {'schema_version': 1, 'tool': fn.__name__, 'arguments': arguments,
                   'started_at': datetime.now(timezone.utc).isoformat(), 'inputs': [],
                   'artifact_directory': str(out), 'model_api_calls': 0,
                   'overall_design_acceptance': 'not_evaluated'}
        token = CALL.set(receipt)
        start = time.monotonic()
        try:
            receipt.update(await fn(*args, **kwargs))
            receipt['ok'] = True
        except Exception as exc:
            receipt.update(ok=False, error=f'{type(exc).__name__}: {exc}',
                           recovery='Inspect output.log and current session state. A failed mutation may be partial; a timeout does not stop Vivado.')
        finally:
            receipt['duration_seconds'] = round(time.monotonic() - start, 3)
            receipt['finished_at'] = datetime.now(timezone.utc).isoformat()
            (out / 'result.json').write_text(json.dumps(receipt, indent=2, ensure_ascii=False), encoding='utf-8')
            CALL.reset(token)
        return json.dumps(receipt, ensure_ascii=False)
    return wrapper


PRELUDE = r'''
proc eda_wb_emit {key value} {
    binary scan [encoding convertto utf-8 $value] H* encoded
    puts "EDA_WB|$key|$encoded"
}
proc eda_wb_one {objects label} {
    if {[llength $objects] != 1} {error "Expected exactly one $label; found [llength $objects]"}
    return [lindex $objects 0]
}
'''


async def execute(script, session_id, ctx, project_dir='', timeout=180):
    session = _require_session(ctx, session_id)
    if session is None:
        raise ValueError(f'Start session {session_id!r} first')
    guard = ''
    if project_dir:
        expected = location(project_dir, exists=True).as_posix()
        guard = f'''
set eda_project [eda_wb_one [get_projects -quiet] project]
if {{![string equal -nocase [file normalize [get_property DIRECTORY $eda_project]] [file normalize {q(expected)}]]}} {{error "Current project directory does not match project_dir"}}
'''
    body = PRELUDE + guard + script + '\neda_wb_emit completed 1\n'
    out = Path(CALL.get()['artifact_directory'])
    (out / 'command.tcl').write_text(body, encoding='utf-8')
    result = await session.execute(body, timeout=timeout)
    (out / 'output.log').write_text(result.output, encoding='utf-8')
    CALL.get()['tcl_return_code'] = result.return_code
    if result.is_error or result.return_code != 0:
        raise RuntimeError(result.output[-2000:])
    fields = {}
    for line in result.output.splitlines():
        match = re.fullmatch(r'EDA_WB\|([^|]+)\|([0-9a-fA-F]*)', line.strip())
        if match:
            fields.setdefault(match[1], []).append(bytes.fromhex(match[2]).decode('utf-8'))
    if fields.get('completed') != ['1']:
        raise RuntimeError('Missing completion marker; inspect full output')
    return {'observations': fields}


def properties(values, target='$eda_obj'):
    if not values:
        return ''
    for name in values:
        if not re.fullmatch(r'CONFIG\.[A-Za-z0-9_]+', name):
            raise ValueError('Only explicit CONFIG.* properties are accepted')
    pairs = ' '.join(q(k) + ' ' + q(v) for k, v in values.items())
    keys = ' '.join(q(k) for k in values)
    return f'''
foreach key [list {keys}] {{
    if {{[lsearch -exact [list_property {target}] $key] < 0}} {{error "Unknown property $key"}}
    eda_wb_emit before.$key [get_property $key {target}]
}}
set_property -dict [list {pairs}] {target}
foreach key [list {keys}] {{eda_wb_emit after.$key [get_property $key {target}]}}
'''


@mcp.tool()
@logged
async def wb_project_create(project_dir: str, name: str, part: str, sources: list[str] = [],
                            constraints: list[str] = [], top: str = '', session_id: str = 'default', ctx: Context = None) -> str:
    """Create a fresh disk project with explicit part, sources and constraints. Refuses existing directory/open project."""
    directory = location(project_dir)
    if directory.exists():
        raise ValueError('Project directory already exists; creation never overwrites')
    src, xdc = files(sources), files(constraints)
    script = f'''if {{[llength [get_projects -quiet]]}} {{error "Close the current project first"}}
if {{[file exists {q(directory.as_posix())}]}} {{error "Project directory already exists"}}
create_project {identifier(name)} {q(directory.as_posix())} -part {q(part)}
'''
    if sources:
        script += f'add_files -fileset sources_1 -norecurse {src}\n'
    if constraints:
        script += f'add_files -fileset constrs_1 -norecurse {xdc}\n'
    if top:
        script += f'set_property top {identifier(top)} [get_filesets sources_1]\n'
    script += 'eda_wb_emit project_file [file join [get_property DIRECTORY [current_project]] "[get_property NAME [current_project]].xpr"]\n'
    return await execute(script, session_id, ctx)


@mcp.tool()
@logged
async def wb_project_open(project_file: str, session_id: str = 'default', ctx: Context = None) -> str:
    """Open an explicitly named existing .xpr, refusing to replace an open project."""
    path = location(project_file, exists=True)
    if path.suffix.lower() != '.xpr':
        raise ValueError('Expected .xpr')
    files([str(path)])
    return await execute(f'''if {{[llength [get_projects -quiet]]}} {{error "Close the current project first"}}
open_project {q(path.as_posix())}
eda_wb_emit project_file [file join [get_property DIRECTORY [current_project]] "[get_property NAME [current_project]].xpr"]
''', session_id, ctx)


@mcp.tool()
@logged
async def wb_project_add_files(project_dir: str, paths: list[str], fileset: str = 'sources_1', top: str = '',
                               session_id: str = 'default', ctx: Context = None) -> str:
    """Add existing RTL, testbench or constraints to an explicit fileset; update compile order."""
    if fileset not in ('sources_1', 'sim_1', 'constrs_1') or not paths:
        raise ValueError('Use a nonempty file list and sources_1, sim_1 or constrs_1')
    script = f'add_files -fileset {q(fileset)} -norecurse {files(paths)}\n'
    if top:
        if fileset == 'constrs_1':
            raise ValueError('Constraints fileset has no top')
        script += f'set_property top {identifier(top)} [get_filesets {q(fileset)}]\n'
    if fileset != 'constrs_1':
        script += f'update_compile_order -fileset {q(fileset)}\n'
    script += f'foreach f [get_files -of_objects [get_filesets {q(fileset)}]] {{eda_wb_emit file $f}}\n'
    return await execute(script, session_id, ctx, project_dir)


@mcp.tool()
@logged
async def wb_ip_create(project_dir: str, name: str, vlnv: str, config: dict[str, str] = {},
                       session_id: str = 'default', ctx: Context = None) -> str:
    """Instantiate an exact catalog VLNV, optionally configure it and record property readback. Refuses duplicates."""
    n = identifier(name)
    config_tcl = properties(config)
    return await execute(f'''if {{[llength [get_ips -quiet {n}]]}} {{error "IP already exists"}}
eda_wb_one [get_ipdefs -all -quiet {q(vlnv)}] IP_definition
create_ip -vlnv {q(vlnv)} -module_name {n}
set eda_obj [eda_wb_one [get_ips -quiet {n}] IP]
{config_tcl}
eda_wb_emit ip $eda_obj
eda_wb_emit ip_file [get_property IP_FILE $eda_obj]
''', session_id, ctx, project_dir)


@mcp.tool()
@logged
async def wb_ip_configure(project_dir: str, name: str, config: dict[str, str],
                          session_id: str = 'default', ctx: Context = None) -> str:
    """Validate property names before changing an IP; record old and resulting CONFIG values. Changes may invalidate products."""
    if not config:
        raise ValueError('Provide CONFIG properties')
    return await execute(f'set eda_obj [eda_wb_one [get_ips -quiet {identifier(name)}] IP]\n' + properties(config), session_id, ctx, project_dir)


@mcp.tool()
@logged
async def wb_ip_generate(project_dir: str, name: str, synthesize: bool = False,
                         session_id: str = 'default', ctx: Context = None) -> str:
    """Generate all IP output products and optionally run OOC synth_ip. No implementation or functional acceptance implied."""
    script = f'set eda_obj [eda_wb_one [get_ips -quiet {identifier(name)}] IP]\ngenerate_target all $eda_obj\n'
    if synthesize:
        script += 'synth_ip $eda_obj\n'
    script += 'foreach f [get_files -all -of_objects $eda_obj] {eda_wb_emit product $f}\n'
    return await execute(script, session_id, ctx, project_dir, timeout=900)


@mcp.tool()
@logged
async def wb_bd_create(project_dir: str, name: str, session_id: str = 'default', ctx: Context = None) -> str:
    """Create and save a new IP Integrator Block Design. Existing designs are refused."""
    return await execute(f'''create_bd_design {identifier(name)}
save_bd_design
eda_wb_emit bd [current_bd_design]
''', session_id, ctx, project_dir)


def bd_guard(name):
    return f'''if {{[current_bd_design -quiet] ne {identifier(name)}}} {{error "Current Block Design does not match bd_name"}}
'''


@mcp.tool()
@logged
async def wb_bd_add_ip(project_dir: str, bd_name: str, name: str, vlnv: str, config: dict[str, str] = {},
                       session_id: str = 'default', ctx: Context = None) -> str:
    """Add a catalog IP to the selected Block Design, configure it and return scalar/interface pins."""
    n = identifier(name)
    script = bd_guard(bd_name) + f'''if {{[llength [get_bd_cells -quiet {n}]]}} {{error "BD cell already exists"}}
eda_wb_one [get_ipdefs -all -quiet {q(vlnv)}] IP_definition
set eda_obj [create_bd_cell -type ip -vlnv {q(vlnv)} {n}]
''' + properties(config) + '''
foreach p [get_bd_pins -quiet -of_objects $eda_obj] {eda_wb_emit pin $p}
foreach p [get_bd_intf_pins -quiet -of_objects $eda_obj] {eda_wb_emit interface $p}
save_bd_design
'''
    return await execute(script, session_id, ctx, project_dir)


def endpoint(path, interface=False):
    if not re.fullmatch(r'/?[A-Za-z][A-Za-z0-9_/]*', path):
        raise ValueError('Expected an exact pin or port path, without Tcl patterns')
    kind = 'intf_' if interface else ''
    return f'[eda_wb_one [concat [get_bd_{kind}pins -quiet {q(path)}] [get_bd_{kind}ports -quiet {q(path)}]] endpoint]'


@mcp.tool()
@logged
async def wb_bd_connect(project_dir: str, bd_name: str, endpoints: list[str], interface: bool = False,
                         session_id: str = 'default', ctx: Context = None) -> str:
    """Connect at least two exact scalar pins/ports or bus interfaces; validates every endpoint before mutation."""
    if len(endpoints) < 2 or len(set(endpoints)) != len(endpoints):
        raise ValueError('Provide at least two distinct endpoints')
    script = bd_guard(bd_name) + 'set eda_ends [list ' + ' '.join(endpoint(p, interface) for p in endpoints) + ']\n'
    script += ('connect_bd_intf_net' if interface else 'connect_bd_net') + ' {*}$eda_ends\nsave_bd_design\n'
    script += 'foreach p $eda_ends {eda_wb_emit connected $p}\n'
    return await execute(script, session_id, ctx, project_dir)


@mcp.tool()
@logged
async def wb_bd_external(project_dir: str, bd_name: str, pin: str, interface: bool = False,
                          session_id: str = 'default', ctx: Context = None) -> str:
    """Make one unconnected IP pin/interface external, returning the generated external port name."""
    kind = 'intf_' if interface else ''
    script = bd_guard(bd_name) + f'''set eda_pin {endpoint(pin, interface)}
set eda_external [make_bd_{kind}pins_external $eda_pin]
eda_wb_emit external $eda_external
save_bd_design
'''
    return await execute(script, session_id, ctx, project_dir)


@mcp.tool()
@logged
async def wb_bd_assign_address(project_dir: str, bd_name: str, session_id: str = 'default', ctx: Context = None) -> str:
    """Auto-assign unmapped BD address segments and return offset/range. Existing mappings stay under Vivado's policy."""
    script = bd_guard(bd_name) + '''assign_bd_address
foreach space [get_bd_addr_spaces -quiet] {
    foreach seg [get_bd_addr_segs -quiet -of_objects $space] {
        set offset [get_property OFFSET $seg]
        if {$offset ne ""} {
            eda_wb_emit address "$seg|$offset|[get_property RANGE $seg]"
        } else {
            eda_wb_emit slave_segment "$seg|[get_property RANGE $seg]"
        }
    }
}
save_bd_design
'''
    return await execute(script, session_id, ctx, project_dir)


@mcp.tool()
@logged
async def wb_bd_validate_export(project_dir: str, bd_name: str, generate_products: bool = True,
                                session_id: str = 'default', ctx: Context = None) -> str:
    """Validate connectivity, save BD/Tcl and optionally generate products plus top HDL wrapper. Not functional/signoff verification."""
    out = Path(CALL.get()['artifact_directory']) / 'design.tcl'
    script = bd_guard(bd_name) + f'''validate_bd_design
save_bd_design
write_bd_tcl {q(out.as_posix())}
eda_wb_emit bd_tcl {q(out.as_posix())}
'''
    if generate_products:
        script += f'''set eda_bd_file [eda_wb_one [get_files -quiet */{identifier(bd_name)[1:-1]}.bd] BD_file]
generate_target all $eda_bd_file
set eda_wrappers [make_wrapper -files [list $eda_bd_file] -top]
# Vivado 2020.2 returns an unquoted path for one wrapper, even with spaces.
if {{[file isfile $eda_wrappers]}} {{set eda_wrappers [list $eda_wrappers]}}
foreach f $eda_wrappers {{if {{![file isfile $f]}} {{error "Missing generated wrapper: $f"}}}}
add_files -norecurse $eda_wrappers
update_compile_order -fileset sources_1
foreach f $eda_wrappers {{eda_wb_emit wrapper $f}}
'''
    return await execute(script, session_id, ctx, project_dir, timeout=900)


@mcp.tool()
@logged
async def wb_project_export(project_dir: str, session_id: str = 'default', ctx: Context = None) -> str:
    """Export a project reconstruction Tcl to a fresh evidence directory; referenced source files are not bundled."""
    out = Path(CALL.get()['artifact_directory']) / 'project.tcl'
    restored = ROOT / 'projects' / ('wb-restore-' + uuid.uuid4().hex[:12])
    # 2020.2's -absolute_path export omits quotes around remote filenames.
    # Relative expressions with an explicit origin preserve spaces correctly.
    result = await execute(f'write_project_tcl -use_bd_files -no_copy_sources -paths_relative_to {q(ROOT.as_posix())} -origin_dir_override {q(ROOT.as_posix())} -target_proj_dir {q(restored.as_posix())} {q(out.as_posix())}\neda_wb_emit project_tcl {q(out.as_posix())}\neda_wb_emit restore_directory {q(restored.as_posix())}\n', session_id, ctx, project_dir)
    original = out.read_text(encoding='utf-8')
    out.with_name('project.raw.tcl').write_text(original, encoding='utf-8')
    # Apply the same verified one-path normalization to Vivado's generated replay.
    needle = '  add_files -norecurse -fileset sources_1 $wrapper_path'
    normalized = original.replace(needle, '  if {[file isfile $wrapper_path]} {set wrapper_path [list $wrapper_path]}\n' + needle)
    out.write_text(normalized, encoding='utf-8')
    result['wrapper_path_normalizations'] = original.count(needle)
    return result


if __name__ == '__main__':
    mcp.run(transport='stdio')
