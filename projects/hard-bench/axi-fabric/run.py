"""Only local XSim. Keep all failed receipts and reject Fatal even on exit code zero."""
import datetime,hashlib,json,pathlib,re,subprocess,sys,time
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[2]
mode=sys.argv[1] if len(sys.argv)>1 else 'sim'
assert mode in ('sim','negative','trace')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
out=HERE/'runs'/f'{stamp}-{mode}';out.mkdir(parents=True)
start=time.monotonic()
with (out/'invocation.log').open('w',encoding='utf-8') as f:
 p=subprocess.Popen(['node','scripts/eda-tool.mjs','eda_xsim',str(HERE/f'{mode}.json')],cwd=ROOT,stdout=f,stderr=subprocess.STDOUT)
 code=p.wait()
invocation=(out/'invocation.log').read_text(encoding='utf-8',errors='replace')
match=re.search(r'^\{\s*"directory":',invocation,re.M)
data=json.loads(invocation[match.start():]) if match else {}
directory=data.get('directory')
if not directory:
 evidence=re.search(r'evidence: ([^\r\n]+)',invocation)
 if evidence:directory=evidence.group(1).strip()
log=(pathlib.Path(directory)/'process.log').read_text(errors='replace') if directory and (pathlib.Path(directory)/'process.log').exists() else invocation
marker='HARD_BENCH_TRACE_PASS project=axi_fabric' if mode=='trace' else 'HARD_BENCH_PASS project=axi_fabric'
if mode=='negative':passed='FABRIC_NEGATIVE_INJECTION one_read_data_bit' in log and 'Fatal: FABRIC_READ_DATA' in log and 'HARD_BENCH_PASS' not in log
else:passed=code==0 and marker in log and not re.search(r'Fatal:|FATAL|ERROR:|TIMEOUT',log)
result={'project':'axi_fabric','mode':mode,'pass':passed,'exit_code':code,'wall_seconds':round(time.monotonic()-start,2),'artifact_directory':directory,'receipt_directory':str(out),'pass_marker':marker if mode!='negative' else 'expected Fatal: FABRIC_READ_DATA','other_model_api_calls':0}
if mode=='sim' and passed:
 summary=re.search(r'HARD_BENCH_PASS project=axi_fabric ([^\r\n]+)',log)
 result['metrics']={k:int(v) for k,v in re.findall(r'(\w+)=(\d+)',summary.group(1))}
 result['masters']=[{k:int(v) for k,v in re.findall(r'(\w+)=(\d+)',line)} for line in log.splitlines() if line.startswith('FABRIC_MASTER_METRICS')]
 result['targets']=[{'target':row['master'],'write_bursts':row.pop('target_writes'),'read_bursts':row.pop('target_reads')} for row in result['masters']]
 order=re.search(r'FABRIC_ORDER_METRICS ([^\r\n]+)',log)
 result['metrics'].update({k:int(v) for k,v in re.findall(r'(\w+)=(\d+)',order.group(1))})
 assert result['metrics']['write_bursts']+result['metrics']['read_bursts']==4656
 result['manifest']=json.loads((HERE/'manifest.json').read_text())
 result['testbench_sha256']=hashlib.sha256((HERE/'tb_axi_fabric.sv').read_bytes()).hexdigest()
(out/'result.json').write_text(json.dumps(result,indent=2));(HERE/f'latest-{mode}.json').write_text(json.dumps(result,indent=2))
if mode=='sim':(HERE/'result.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
if not passed:print(log[-3500:])
raise SystemExit(0 if passed else 1)
