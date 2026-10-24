"""Summarize executed DMA receipts and preserve the exact sources for replay."""
import collections,hashlib,json,pathlib,re,shutil
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
sim=json.loads((HERE/'latest-sim.json').read_text())
impl=json.loads((HERE/'latest-impl.json').read_text())
negative=json.loads((HERE/'latest-negative.json').read_text())
assert sim['pass'] and impl['pass'] and negative['expected_rejection_observed']
sim_dir=pathlib.Path(sim['artifact_directory']);impl_dir=pathlib.Path(impl['artifact_directory'])
log=(sim_dir/'process.log').read_text(errors='replace')
summary=re.search(r'SYSTEM_BENCH_PASS project=dma (.+)',log)
assert summary
metrics={key:int(value) for key,value in re.findall(r'(\w+)=(\d+)',summary.group(1))}
cases=[dict(re.findall(r'(\w+)=(\S+)',line)) for line in log.splitlines() if line.startswith('DMA_CASE_PASS')]
assert len(cases)==metrics['scenarios']==717 and metrics['byte_checks']>=2000000
assert sum(int(c['length']) for c in cases)==metrics['byte_checks']
families={name:{'cases':len(group),'bytes_checked':sum(int(c['length']) for c in group),
                'seeds':sorted({c['seed'] for c in group})}
          for name in sorted({c['family'] for c in cases})
          for group in [[c for c in cases if c['family']==name]]}
assert len({(int(c['src'],16)%4,int(c['dst'],16)%4) for c in cases if c['family']=='alignment_length'})==16
assert len({int(c['length']) for c in cases if c['family']=='alignment_length'})==24
ppa=json.loads((impl_dir/'build-result.json').read_text())
util=(impl_dir/'utilization.rpt').read_text()
ppa['physical_slice_luts']=int(re.search(r'\| Slice LUTs\s+\|\s*(\d+)',util).group(1))
ppa['physical_slice_registers']=int(re.search(r'\| Slice Registers\s+\|\s*(\d+)',util).group(1))
sources=json.loads((HERE/'sources.json').read_text())['sources']
snapshot=pathlib.Path(sim['receipt_directory'])/'source-snapshot'
files=[]
for rel in sources+['projects/system-bench/dma/tb_dma.sv','projects/system-bench/dma/tb_template.sv',
                    'projects/system-bench/dma/tb_dma_negative.sv','projects/system-bench/generate_dma.py',
                    'projects/system-bench/dma/run_negative.py']:
    source=ROOT/rel;target=snapshot/rel;target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(source,target)
    content=source.read_bytes()
    files.append({'path':rel,'sha256':hashlib.sha256(content).hexdigest(),'lines':len(content.splitlines()),
                  'module_declarations':len(re.findall(rb'^module\s+',content,re.M))})
report={'project':'dma','functional':sim,'metrics':metrics,'scenario_families':families,
        'negative_control':negative,'implementation':impl,'ppa':ppa,'source_files':files,
        'compiled_rtl_lines':sum(f['lines'] for f in files if f['path'] in sources),
        'compiled_rtl_module_declarations':sum(f['module_declarations'] for f in files if f['path'] in sources),
        'upstream':{'verilog-axi':'516bd5dadc3365b7f9e225d2af8fe0b8d804fe53',
                    'verilog-ethernet':'77320a9471d19c7dd383914bc049e02d9f4f1ffb'},
        'retained_failed_runs':[{'directory':str(ROOT/'artifacts/2026-10-22T18-08-42-736Z-xsim-55168f50'),
            'completed_cases':716,'reason':'Last test source range overlapped its destination guard by three bytes.',
            'fix':'Reduce that length from 32763 to 32760 to preserve a four-byte guard gap; no RTL change.'},
            {'directory':str(ROOT/'artifacts/2026-10-22T18-10-27-611Z-xsim-3de4e643'),
             'completed_cases':717,'reason':'Coverage gate rejected missing AXI R and AXIS backpressure before reset.'},
            {'directory':str(ROOT/'artifacts/2026-10-22T18-12-20-748Z-xsim-18c39abd'),
             'completed_cases':717,'reason':'A 32-cycle wait achieved AXIS backpressure but not AXI R backpressure.',
             'fix':'Wait for an actual AXI R VALID && !READY event before resetting; retain coverage gate.'}],
        'limits':['64 KiB single-outstanding AXI memory model, 32-bit data path, non-overlapping copies only.',
                  'Error responses retain data; verified error status/recovery, not fault rollback semantics.',
                  'Zero-length, overlapping copies, asynchronous reset and real DDR/controller integration are not covered.',
                  '100 MHz OOC internal timing only; clock source and interface pin placement are not physically fixed.',
                  'No board/bitstream/hardware test; DRC contains CFGBVS-1 and RTSTAT-10 warnings.'],
        'other_model_api_calls':0}
(HERE/'assessment.json').write_text(json.dumps(report,indent=2))
print(json.dumps({k:report[k] for k in ('metrics','scenario_families','compiled_rtl_lines','compiled_rtl_module_declarations')},indent=2))
