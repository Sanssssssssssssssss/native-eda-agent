"""Prepare a Vivado view of the actual completed GMII simulation database."""
import json
from pathlib import Path
import xml.etree.ElementTree as ET

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / 'artifacts/hard-bench-assessment-20261023'
result = json.loads((ROOT / 'projects/hard-bench/ethernet-cdc/result-a.json').read_text())
wdb = Path(result['artifact_directory']) / 'eda_snapshot.wdb'
assert result['pass'] and wdb.exists()
root = ET.Element('wave_config')
ET.SubElement(root, 'wave_state')
db = ET.SubElement(ET.SubElement(root, 'db_ref_list'), 'db_ref', path=wdb.as_posix(), id='1')
ET.SubElement(ET.SubElement(db, 'top_modules'), 'top_module', name='tb_ethernet_cdc_a')
zoom = ET.SubElement(root, 'zoom_setting')
for tag, ns in [('ZoomStartTime', 100000), ('ZoomEndTime', 100500), ('Cursor1Time', 100250)]:
    ET.SubElement(zoom, tag, time=f'{ns * 1000000}fs')
columns = ET.SubElement(root, 'column_width_setting')
ET.SubElement(columns, 'NameColumnWidth', column_width='210')
ET.SubElement(columns, 'ValueColumnWidth', column_width='85')
signals = [('logic_clk', 1), ('rx_clk', 1), ('tx_clk', 1), ('reset', 1), ('current_case', 32),
           ('gmii_rx_dv', 1), ('gmii_rxd', 8), ('gmii_rx_er', 1), ('gmii_tx_en', 1),
           ('gmii_txd', 8), ('gmii_tx_er', 1), ('frames', 32), ('position', 32),
           ('tx_wire_bytes', 32), ('app_received', 32), ('app_echoed', 32),
           ('forced_pause', 1), ('stall_cycles', 32), ('bad_fcs_count', 32), ('guard_count', 32)]
ET.SubElement(root, 'WVObjectSize', size=str(len(signals)))
for name, width in signals:
    obj = ET.SubElement(root, 'wvobject', fp_name=f'/tb_ethernet_cdc_a/{name}', type='logic' if width == 1 else 'array')
    for prop in ['ElementShortName', 'ObjectShortName']:
        ET.SubElement(obj, 'obj_property', name=prop).text = name if width == 1 else f'{name}[{width-1}:0]'
    if width > 1:
        ET.SubElement(obj, 'obj_property', name='Radix').text = 'HEXRADIX' if width == 8 else 'UNSIGNEDDECRADIX'
ET.indent(root)
ET.ElementTree(root).write(OUT / 'ethernet-wave.wcfg', encoding='utf-8', xml_declaration=True)
command = f'''close_project
create_project -in_memory -part xc7a100tfgg676-2
open_wave_database {{{wdb.as_posix()}}}
open_wave_config {{{(OUT / 'ethernet-wave.wcfg').as_posix()}}}
puts "HARD_WAVE_READY"
'''
(ROOT / 'projects/hard-bench/gui-command.tcl').write_text(command)
print(wdb)
