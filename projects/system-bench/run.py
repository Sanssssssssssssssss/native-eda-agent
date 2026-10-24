"""Run the existing native EDA tool, save receipts, reject timeout/false passes."""
import datetime,json,pathlib,re,subprocess,sys,time
ROOT=pathlib.Path(__file__).resolve().parents[2]
name,stage=sys.argv[1:3]
assert name in ('soc','dma','udp','aes') and stage in ('sim','impl')
d=ROOT/'projects/system-bench'/name
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
receipt=ROOT/'artifacts'/f'system-{name}-{stage}-{stamp}'
receipt.mkdir()
start=time.monotonic()
cmd=['node','scripts/eda-tool.mjs','eda_xsim' if stage=='sim' else 'eda_vivado',str(d/f'{stage}.json')]
with (receipt/'invocation.log').open('w',encoding='utf-8') as log:
    p=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace')
    in_receipt=False
    for line in p.stdout:
        log.write(line);log.flush()
        if line.startswith('{'):in_receipt=True
        if not in_receipt:print(line,end='',flush=True)
    code=p.wait()
text=(receipt/'invocation.log').read_text(encoding='utf-8')
match=re.search(r'^\{\s*"directory":',text,re.M)
data=json.loads(text[match.start():]) if match else {}
out=pathlib.Path(data['directory']) if data else None
if out is None:
    # A native tool failure can precede receipt emission. Keep its real log path.
    paths=re.findall(r'(?:log: |inspect )([^\r\n]*[\\/]process\.log)',text)
    if paths:out=pathlib.Path(paths[-1]).parent
if out and 'build_result' not in data and (out/'build-result.json').exists():
    data['build_result']=json.loads((out/'build-result.json').read_text())
log=(out/'process.log').read_text(errors='replace') if out else text
if stage=='sim':
    verdict=code==0 and bool(re.search(r'SYSTEM_BENCH_PASS project='+name+r'\b',log)) and not re.search(r'Fatal:|FATAL:|Error:|TIMEOUT',log)
else:
    b=data.get('build_result',{})
    verdict=code==0 and b.get('stage')=='routed' and b.get('setup_slack_ns',-1)>=0 and b.get('hold_slack_ns',-1)>=0
result={'project':name,'stage':stage,'pass':verdict,'exit_code':code,'wall_seconds':round(time.monotonic()-start,2),'artifact_directory':str(out) if out else None,'receipt_directory':str(receipt),'other_model_api_calls':0}
(receipt/'result.json').write_text(json.dumps(result,indent=2))
(d/f'latest-{stage}.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
sys.exit(0 if verdict else 1)
