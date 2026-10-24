"""Collect local test receipts without invoking any EDA or model service."""
import hashlib,json,pathlib,re

HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
result=json.loads((HERE/'latest-sim.json').read_text())
result['schema_version']=1
if result['masters'] and 'target_writes' in result['masters'][0]:
    # The raw summary prints master and target counters at the same numeric index.
    # Keep their different meanings explicit in the machine-readable final report.
    result['targets']=[{'target':row['master'],'write_bursts':row.pop('target_writes'),'read_bursts':row.pop('target_reads')} for row in result['masters']]
assert sum(row['write_bursts'] for row in result['targets'])+result['metrics']['decerr_writes']==result['metrics']['write_bursts']
assert sum(row['read_bursts'] for row in result['targets'])+result['metrics']['decerr_reads']==result['metrics']['read_bursts']
result['score_unit']='one integrated fabric system; 4656 transactions are not 4656 benchmark tasks'
for mode in ('negative','trace'):
    p=HERE/f'latest-{mode}.json'
    if p.exists():result['negative_control' if mode=='negative' else 'trace']=json.loads(p.read_text())
result['functional_pass']=result['pass']
result['evidence_complete']=all(result.get(k,{}).get('pass',False) for k in ('negative_control','trace'))
result['topology']={'masters':3,'targets':3,'ram_targets':2,'ram_total_bytes':32768,'data_width':32,'address_width':16,'input_id_width':4,'target_id_width':6,'configured_accept_per_master':8,'configured_threads_per_master':4,'independent_target_channel_delay_buffers':15}
result['known_limits']=[
    'Aligned 32-bit INCR bursts, lengths 1/2/4/8/16/32/64 only; no FIXED, WRAP, narrow, exclusive, USER/QoS or AXI5 coverage.',
    'Concurrent reads/writes use disjoint address regions; shared cross-master reads occur after a write completion barrier. Same-address data races are not covered.',
    'Same-ID read ordering is independently checked using expected beat data and response queues. Identical BID/BRESP responses cannot individually identify two otherwise identical write responses.',
    'Resets occur between seed batches; no reset during an outstanding fabric transaction is claimed.',
    'The local address/write overlays are validated together with the AW/W completion guard, at the pinned commit and this configuration. They are not a general upstream fix claim.',
    'All results are local XSim simulation or separately reported OOC implementation; no board test, formal proof or public benchmark ranking.'
]
result['upstream_overlay']={'patch':str(HERE/'upstream-fix.patch'),'patch_sha256':hashlib.sha256((HERE/'upstream-fix.patch').read_bytes()).hexdigest(),'vendor_edited':False,'required_companion':'axi_write_completion_guard.sv and WVALID/WREADY gating in axi_fabric_top.sv'}
result['source_hashes_current_match']=all(hashlib.sha256((ROOT/p).read_bytes()).hexdigest()==h for p,h in result['manifest']['sha256'].items())
result['testbench_hash_current_match']=hashlib.sha256((HERE/'tb_axi_fabric.sv').read_bytes()).hexdigest()==result['testbench_sha256']
assert result['source_hashes_current_match'] and result['testbench_hash_current_match']
classifications={
 'f8eff2cd':'RTL failure: unmodified pinned crossbar emitted a DECERR write response before the corresponding accepted AW/WLAST.',
 'bf721c98':'Diagnostic reproduction of the early DECERR B response with AW/W descriptor counters.',
 '115befc5':'RTL failure: same-ID DECERR read response overtook a prior mapped SLVERR transaction.',
 '792c10c4':'Diagnostic reproduction of same-ID read response reordering.',
 '06da5217':'Manually stopped the verified test process tree after stalled progress to add bounded phase diagnostics; not classified as an XSim crash or confirmed RTL failure.',
 '1234024d':'RTL failure: bounded phase timeout, all reads completed but writes deadlocked with only an external B guard.',
 '0330eec8':'Diagnostic reproduction: early DECERR occupied B arbitration while its WLAST depended on earlier SLVERR progress; target B/AW/W channels blocked.',
 'fcab51e1':'Coverage failure only: all 20 phases completed but same-write-ID outstanding depth was 1; strengthened write stimulus to consecutive pairs per ID.'
}
attempts=[]
for path in sorted((HERE/'runs').glob('*/result.json')):
    receipt=json.loads(path.read_text())
    art=receipt.get('artifact_directory') or ''
    item={k:receipt.get(k) for k in ('mode','pass','wall_seconds','artifact_directory','receipt_directory')}
    item['classification']=next((v for k,v in classifications.items() if k in art),'accepted test receipt' if receipt.get('pass') else 'unclassified failure; inspect log')
    attempts.append(item)
result['attempt_history']=attempts
result['usage']={'other_model_api_calls':0,'recorded_runs':len(attempts),'sum_run_wall_seconds_including_queue_and_overlaps':round(sum(x['wall_seconds'] for x in attempts),2),'functional_success_run_wall_seconds':result['wall_seconds'],'failed_attempts_preserved':sum(not x['pass'] for x in attempts),'note':'Summed run durations are not end-to-end elapsed time; simultaneous runs and resource-queue waits can overlap. Current Codex token usage is not measured here.'}
impl_path=HERE/'latest-impl.json'
result['implementation']={'status':'not_run','sources':str(HERE/'sources.json'),'config':str(HERE/'impl.json'),'tcl':str(HERE/'implement.tcl'),'clock_mhz':100,'part':'xc7a100tfgg676-2','mode':'out_of_context'}
if impl_path.exists():
    impl=json.loads(impl_path.read_text())
    artifact=pathlib.Path(impl['artifact_directory'])
    frozen_hashes=json.loads((artifact/'input-hashes.json').read_text())
    impl_inputs=list(result['manifest']['sha256'])+['projects/hard-bench/axi-fabric/sources.json','projects/hard-bench/axi-fabric/implement.tcl','projects/system-bench/implement-common.tcl']
    impl['current_source_drift']=[p for p in impl_inputs if hashlib.sha256((ROOT/p).read_bytes()).hexdigest()!=frozen_hashes.get(p)]
    impl['status']='stale' if impl['current_source_drift'] else 'passed' if impl['pass'] else 'failed'
    impl['receipt']=str(impl_path)
    utilization=(artifact/'utilization.rpt').read_text()
    def physical_count(label):
        match=re.search(r'^\|\s*'+re.escape(label)+r'\s*\|\s*(\d+)\s*\|',utilization,re.M)
        if not match:raise ValueError(f'Missing physical utilization field: {label}')
        return int(match.group(1))
    impl['physical_utilization']={'slice_luts':physical_count('Slice LUTs'),'slice_registers':physical_count('Slice Registers'),'ramb36':physical_count('RAMB36/FIFO*'),'ramb18':physical_count('RAMB18')}
    impl['reports']={name:str(artifact/name) for name in ('utilization.rpt','timing-summary.rpt','route-status.rpt','drc.rpt','process.log','input-hashes.json')}
    result['implementation'].update(impl)
    attempts.append({'mode':'impl','pass':impl['status']=='passed','wall_seconds':impl['wall_seconds'],'artifact_directory':str(artifact),'receipt_directory':str(artifact),'classification':'parent-run frozen OOC implementation receipt; auxiliary helper drift retained separately'})
    result['usage']['recorded_simulation_runs']=result['usage']['recorded_runs']
    result['usage']['recorded_implementation_runs']=1
    result['usage']['recorded_runs']=len(attempts)
    result['usage']['implementation_run_wall_seconds']=impl['wall_seconds']
    result['usage']['sum_run_wall_seconds_including_queue_and_overlaps']=round(sum(x['wall_seconds'] for x in attempts),2)
result['acceptance_pass']=result['functional_pass'] and result['evidence_complete'] and result['implementation']['status']=='passed'
for key in ('trace','negative_control'):
    if key in result and result[key].get('artifact_directory'):
        d=pathlib.Path(result[key]['artifact_directory'])
        result[key]['raw_log']=str(d/'process.log')
        if key=='trace':result[key]['waveform_files']=[str(p) for p in d.glob('*.wdb')]
result['raw_log']=str(pathlib.Path(result['artifact_directory'])/'process.log')
result['pass_marker']='HARD_BENCH_PASS project=axi_fabric'
(HERE/'result.json').write_text(json.dumps(result,indent=2))
print(json.dumps({k:result[k] for k in ('functional_pass','evidence_complete','acceptance_pass','source_hashes_current_match','testbench_hash_current_match','usage')},indent=2))
