"""Collect existing receipts and authoritative Vivado reports; never infer a pass."""
import datetime,hashlib,json,pathlib,re,subprocess
ROOT=pathlib.Path(__file__).resolve().parents[2]
HERE=pathlib.Path(__file__).resolve().parent
OUT=ROOT/'artifacts/system-bench-assessment-20261023'
OUT.mkdir(exist_ok=True)
def read_json(p):return json.loads(p.read_text(encoding='utf-8')) if p.exists() else None
def report_integer(text,label):
    m=re.search(r'^\|\s*'+re.escape(label)+r'\s*\|\s*(\d+)\s*\|',text,re.M)
    return int(m[1]) if m else None
def uncomment(text):
    text=re.sub(r'/\*.*?\*/','',text,flags=re.S)
    return re.sub(r'//[^\n]*','',text)
projects=[]
for name in ('soc','dma','udp','aes'):
    d=HERE/name;sources=read_json(d/'sources.json')
    if not sources:continue
    entry={'project':name,'source_files':[], 'sim':read_json(d/'latest-sim.json'),'impl':read_json(d/'latest-impl.json')}
    module_text={}
    for relative in sources['sources']:
        p=ROOT/relative;text=p.read_text(encoding='utf-8')
        entry['source_files'].append({'path':relative,'sha256':hashlib.sha256(p.read_bytes()).hexdigest(),'lines':len(text.splitlines())})
        for module in re.finditer(r'(?ms)^\s*module\s+(\w+)\b.*?^\s*endmodule\b',text):
            module_text[module[1]]=module[0]
    sim=entry['sim'];impl=entry['impl']
    if sim and sim['artifact_directory']:
        run=pathlib.Path(sim['artifact_directory'])
        log=(run/'process.log').read_text(errors='replace')
        passes=re.findall(r'^SYSTEM_BENCH_PASS[^\r\n]+',log,re.M)
        entry['simulation_summary']=passes
        entry['observed_counts']={k:int(v) for k,v in re.findall(r'(\w+)=(\d+)',' '.join(passes))}
        names=set(re.findall(r'Compiling module work\.(\w+)',log))-{'tb_'+name}
        active=sorted(names.intersection(module_text))
        entry['elaborated_module_types']=active
        entry['active_module_source_lines']=sum(len(module_text[n].splitlines()) for n in active)
        entry['active_module_nonblank_code_lines']=sum(sum(bool(line.strip()) for line in uncomment(module_text[n]).splitlines()) for n in active)
        entry['pass_marker_count']=len(passes)
        entry['simulation_verified']=bool(sim['pass'] and len(passes)==1 and not re.search(r'Fatal:|FATAL:|Error:|TIMEOUT',log))
    if impl and impl['artifact_directory']:
        run=pathlib.Path(impl['artifact_directory'])
        entry['physical']=read_json(run/'build-result.json')
        util=(run/'utilization.rpt').read_text(errors='replace') if (run/'utilization.rpt').exists() else ''
        entry['physical_utilization']={
            'slice_luts':report_integer(util,'Slice LUTs'),
            'slice_registers':report_integer(util,'Slice Registers'),
            'ramb36':report_integer(util,'RAMB36/FIFO*'),
            'ramb18':report_integer(util,'RAMB18'),
            'dsp48':report_integer(util,'DSPs')}
        check=(run/'check-timing.rpt').read_text(errors='replace') if (run/'check-timing.rpt').exists() else ''
        entry['timing_checks']={k:int(v) for k,v in re.findall(r'checking (\w+) \((\d+)\)',check)}
        route=(run/'route-status.rpt').read_text(errors='replace') if (run/'route-status.rpt').exists() else ''
        entry['routing_summary']={}
        for label,key in [('routable nets','routable_nets'),('fully routed nets','fully_routed_nets'),('nets with routing errors','routing_errors')]:
            m=re.search(r'# of '+label+r'\.+\s*:\s*(\d+)',route)
            if m:entry['routing_summary'][key]=int(m[1])
    entry['auxiliary_results']={p.name:read_json(p) for p in d.glob('latest-*.json') if p.name not in ('latest-sim.json','latest-impl.json')}
    # Freeze source and fixture hashes at collection time, without copying credentials.
    entry['local_file_hashes']={str(p.relative_to(ROOT)).replace('\\','/'):hashlib.sha256(p.read_bytes()).hexdigest()
        for p in d.rglob('*') if p.is_file() and p.suffix in ('.v','.sv','.py','.tcl','.c','.S','.ld','.hex','.json')}
    projects.append(entry)
vendors={}
for name in ('picorv32','verilog-axi','verilog-ethernet','aes'):
    d=ROOT/'vendor'/name
    if (d/'.git').exists():
        commit=subprocess.check_output(['git','-C',str(d),'rev-parse','HEAD'],text=True).strip()
        status=subprocess.check_output(['git','-C',str(d),'status','--porcelain'],text=True)
        vendors[name]={'commit':commit,'working_tree_clean':not status.strip()}
result={'collected_at_utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'projects':projects,'upstreams':vendors,
    'scope':'Local integration/regression of pinned public cores; not pass@1, not a hidden benchmark, no board execution.',
    'source_line_definition':'Physical text lines within unique module definitions elaborated by XSim; includes comments, interfaces and disabled parameter branches. Nonblank code count is also provided.',
    'resource_definition':'Physical Slice LUTs from report_utilization. Raw LUT primitive count in build-result.json may differ because of packing.'}
(OUT/'results.json').write_text(json.dumps(result,indent=2),encoding='utf-8')
for p in projects:
    print(p['project'], 'sim=',p.get('simulation_verified',False),'impl=',bool(p['impl'] and p['impl']['pass']),
          'module_types=',len(p.get('elaborated_module_types',[])),'active_lines=',p.get('active_module_source_lines'),p.get('physical_utilization'))
print(OUT/'results.json')
