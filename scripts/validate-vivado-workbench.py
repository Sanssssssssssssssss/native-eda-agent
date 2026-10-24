"""Live MCP integration acceptance for project/IP/BD workflows. No model API."""
import asyncio
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sys
import time

from mcp.client.session import ClientSession
from mcp.client.stdio import StdioServerParameters, stdio_client

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / 'artifacts' / ('vivado-workbench-validation-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ'))
OUT.mkdir()
RECEIPT = {'scope': 'MCP project/IP/Block Design integration, not a design benchmark', 'model_api_calls': 0, 'checks': []}


def save():
    (OUT / 'result.json').write_text(json.dumps(RECEIPT, indent=2, ensure_ascii=False), encoding='utf-8')


async def main():
    params = StdioServerParameters(command=sys.executable, args=[str(ROOT / 'src/vivado_workbench.py')], cwd=str(OUT),
                                  env={'VIVADO_PATH': 'E:/Xilinx/Vivado/2020.2/bin/vivado.bat', 'PYTHONUTF8': '1'})
    with (OUT / 'server-stderr.log').open('w', encoding='utf-8') as stderr:
        async with stdio_client(params, errlog=stderr) as streams:
            async with ClientSession(*streams, read_timeout_seconds=1000) as client:
                await client.initialize()
                tool_list = (await client.list_tools()).tools
                RECEIPT['tool_count'] = len(tool_list)
                RECEIPT['prompt_count'] = len((await client.list_prompts()).prompts)
                (OUT / 'tools.json').write_text(json.dumps([t.model_dump(mode='json') for t in tool_list], indent=2), encoding='utf-8')
                assert len(tool_list) == 45, len(tool_list)
                print(f'Discovered {len(tool_list)} tools', flush=True)
                sid = OUT.name

                async def call(label, tool, args, verify=None, expected_ok=True):
                    row = {'label': label, 'tool': tool, 'arguments': args}
                    RECEIPT['checks'].append(row)
                    start = time.monotonic()
                    response = await client.call_tool(tool, args)
                    text = '\n'.join(b.text for b in response.content if b.type == 'text')
                    (OUT / (label + '.txt')).write_text(text, encoding='utf-8')
                    data = json.loads(text) if tool.startswith('wb_') else text
                    good = data.get('ok') is expected_ok if isinstance(data, dict) else '[ERROR]' not in data
                    if verify:
                        good = good and verify(data)
                    row.update(passed=not response.is_error and bool(good), seconds=round(time.monotonic() - start, 3))
                    if isinstance(data, dict):
                        row['artifact_directory'] = data['artifact_directory']
                    save()
                    print(('PASS ' if row['passed'] else 'FAIL ') + label, flush=True)
                    if not row['passed']:
                        raise RuntimeError(f'{label}: {text[-2500:]}')
                    return data

                # Short project path avoids Windows IP products exceeding MAX_PATH.
                project_dir = ROOT / 'projects' / ('wb test-' + datetime.now(timezone.utc).strftime('%m%d-%H%M%S'))
                RECEIPT['project_directory'] = str(project_dir)
                common = {'project_dir': str(project_dir), 'session_id': sid}
                bd = {**common, 'bd_name': 'control_system'}
                fixture = OUT / 'source with spaces.v'
                fixture.write_text('module source_fixture(input wire a, output wire b); assign b = a; endmodule\n', encoding='utf-8')
                illegal_name = OUT / 'source [literal] $name.v'
                illegal_name.write_text(fixture.read_text(), encoding='utf-8')
                fixture_hash = hashlib.sha256(fixture.read_bytes()).hexdigest()
                try:
                    await call('start', 'start_session', {'session_id': sid, 'mode': 'tcl', 'timeout': 60})
                    create_args = {**common, 'name': 'axi_workbench', 'part': 'xc7a100tfgg676-2'}
                    created = await call('create-project', 'wb_project_create', create_args)
                    xpr = Path(created['observations']['project_file'][0])
                    assert xpr.is_file(), xpr
                    await call('duplicate-project-rejected', 'wb_project_create', create_args, expected_ok=False)
                    await call('vivado-illegal-filename-rejected', 'wb_project_add_files', {**common, 'paths': [str(illegal_name)]}, expected_ok=False)
                    await call('add-source-with-special-path', 'wb_project_add_files', {**common, 'paths': [str(fixture)]},
                               lambda v: fixture.name in '\n'.join(v['observations']['file']))
                    wrong = {**common, 'project_dir': str(OUT), 'paths': [str(fixture)]}
                    await call('wrong-project-rejected', 'wb_project_add_files', wrong, expected_ok=False)
                    await call('create-clock-ip', 'wb_ip_create', {**common, 'name': 'standalone_clock', 'vlnv': 'xilinx.com:ip:clk_wiz:6.0'})
                    await call('invalid-ip-property-rejected', 'wb_ip_configure', {**common, 'name': 'standalone_clock', 'config': {'CONFIG.NONEXISTENT_EDA': '1'}}, expected_ok=False)
                    await call('configure-clock-ip', 'wb_ip_configure', {**common, 'name': 'standalone_clock', 'config': {'CONFIG.CLKOUT1_REQUESTED_OUT_FREQ': '50.000'}},
                               lambda v: float(v['observations']['after.CONFIG.CLKOUT1_REQUESTED_OUT_FREQ'][0]) == 50.0)
                    await call('generate-clock-ip', 'wb_ip_generate', {**common, 'name': 'standalone_clock'},
                               lambda v: len(v['observations'].get('product', [])) > 0)
                    await call('create-bd', 'wb_bd_create', {**common, 'name': bd['bd_name']})
                    await call('add-axi-interconnect', 'wb_bd_add_ip', {**bd, 'name': 'fabric', 'vlnv': 'xilinx.com:ip:axi_interconnect:2.1', 'config': {'CONFIG.NUM_MI': '2'}})
                    for i, width in enumerate((8, 16)):
                        await call(f'add-gpio-{i}', 'wb_bd_add_ip', {**bd, 'name': f'gpio_{i}', 'vlnv': 'xilinx.com:ip:axi_gpio:2.0', 'config': {'CONFIG.C_GPIO_WIDTH': str(width), 'CONFIG.C_ALL_OUTPUTS': '1'}})
                        await call(f'connect-axi-{i}', 'wb_bd_connect', {**bd, 'endpoints': [f'fabric/M0{i}_AXI', f'gpio_{i}/S_AXI'], 'interface': True})
                        await call(f'expose-gpio-{i}', 'wb_bd_external', {**bd, 'pin': f'gpio_{i}/GPIO', 'interface': True})
                    await call('invalid-endpoint-rejected', 'wb_bd_connect', {**bd, 'endpoints': ['fabric/MISSING', 'gpio_0/s_axi_aclk']}, expected_ok=False)
                    await call('expose-slave-axi', 'wb_bd_external', {**bd, 'pin': 'fabric/S00_AXI', 'interface': True})
                    await call('expose-clock', 'wb_bd_external', {**bd, 'pin': 'fabric/ACLK'})
                    await call('expose-reset', 'wb_bd_external', {**bd, 'pin': 'fabric/ARESETN'})
                    await call('connect-clocks', 'wb_bd_connect', {**bd, 'endpoints': ['fabric/ACLK', 'fabric/S00_ACLK', 'fabric/M00_ACLK', 'fabric/M01_ACLK', 'gpio_0/s_axi_aclk', 'gpio_1/s_axi_aclk']})
                    await call('connect-resets', 'wb_bd_connect', {**bd, 'endpoints': ['fabric/ARESETN', 'fabric/S00_ARESETN', 'fabric/M00_ARESETN', 'fabric/M01_ARESETN', 'gpio_0/s_axi_aresetn', 'gpio_1/s_axi_aresetn']})
                    addresses = await call('assign-addresses', 'wb_bd_assign_address', bd, lambda v: len(v['observations'].get('address', [])) == 2)
                    RECEIPT['addresses'] = addresses['observations']['address']
                    result = await call('validate-generate-export-bd', 'wb_bd_validate_export', bd,
                                        lambda v: all(Path(p).is_file() for p in v['observations']['wrapper'] + v['observations']['bd_tcl']))
                    RECEIPT['wrapper_files'] = result['observations']['wrapper']
                    exported = await call('export-project', 'wb_project_export', common,
                               lambda v: Path(v['observations']['project_tcl'][0]).is_file())
                    await call('close-project', 'run_tcl', {'session_id': sid, 'command': 'close_project; puts EDA_PROJECT_CLOSED'})
                    await call('reopen-project', 'wb_project_open', {'session_id': sid, 'project_file': str(xpr)})
                    await call('reopen-validate-bd', 'run_tcl', {'session_id': sid, 'command': 'open_bd_design [get_files */control_system.bd]; validate_bd_design; puts EDA_BD_REOPEN_VALID'},
                               lambda v: 'EDA_BD_REOPEN_VALID' in v)
                    export_tcl = Path(exported['observations']['project_tcl'][0]).as_posix()
                    await call('reconstruct-exported-project', 'run_tcl', {'session_id': sid, 'command': 'close_project; source {' + export_tcl + '}; puts EDA_RECONSTRUCTED'},
                               lambda v: 'EDA_RECONSTRUCTED' in v)
                    restored_dir = Path(exported['observations']['restore_directory'][0])
                    assert (restored_dir / 'axi_workbench.xpr').is_file()
                    assert fixture_hash == hashlib.sha256(fixture.read_bytes()).hexdigest()
                    RECEIPT['source_unchanged'] = True
                finally:
                    await call('stop', 'stop_session', {'session_id': sid})
                await call('sessions-closed', 'list_sessions', {}, lambda v: sid not in v)
                RECEIPT['passed'] = all(row['passed'] for row in RECEIPT['checks'])


if __name__ == '__main__':
    try:
        asyncio.run(main())
    except Exception as exc:
        RECEIPT.update(passed=False, error=f'{type(exc).__name__}: {exc}')
        raise
    finally:
        RECEIPT['finished_at'] = datetime.now(timezone.utc).isoformat()
        save()
        print(str(OUT), flush=True)
