"""Local native XSim invocation, immutable evidence and strict log verdict."""
import datetime,hashlib,json,pathlib,re,shutil,subprocess,sys,time
HERE=pathlib.Path(__file__).resolve().parent;ROOT=HERE.parents[2]
stage=sys.argv[1] if len(sys.argv)>1 else 'sim'
assert stage in ('sim','negative','warm')
negative=stage=='negative'
cfg=json.loads((HERE/'sim.json').read_text())
if stage!='sim':
    cfg['sources'].append(f'projects/hard-bench/crypto-soc/tb_crypto_soc_{stage}.sv')
    cfg['top']=f'tb_crypto_soc_{stage}';cfg['capture_top_wave']=False
    (HERE/f'{stage}.json').write_text(json.dumps(cfg,indent=2))
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
receipt=ROOT/'artifacts'/f'hard-crypto-soc-{stage}-{stamp}';receipt.mkdir()
shutil.copy2(HERE/'manifest.json',receipt/'manifest.json')
for p in HERE.iterdir():
    if p.is_file() and p.suffix in ('.sv','.S','.c','.h','.ld','.hex','.py','.json','.tcl'):
        (receipt/'inputs').mkdir(exist_ok=True);shutil.copy2(p,receipt/'inputs'/p.name)
manifest=json.loads((HERE/'manifest.json').read_text())
for source in manifest['source_files']:
    target=receipt/'sources'/source
    target.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(ROOT/source,target)
start=time.monotonic()
cmd=['node','scripts/eda-tool.mjs','eda_xsim',str(HERE/f'{stage}.json')]
with (receipt/'invocation.log').open('w',encoding='utf-8') as log:
    p=subprocess.Popen(cmd,cwd=ROOT,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,encoding='utf-8',errors='replace')
    in_json=False
    for line in p.stdout:
        log.write(line);log.flush()
        if line.startswith('{'):in_json=True
        if not in_json:print(line,end='',flush=True)
    code=p.wait()
raw=(receipt/'invocation.log').read_text(encoding='utf-8')
match=re.search(r'^\{\s*"directory":',raw,re.M)
data=json.loads(raw[match.start():]) if match else {}
directory=data.get('directory')
if not directory:
    paths=re.findall(r'(?:log: |inspect )([^\r\n]*[\\/]process\.log)',raw)
    directory=str(pathlib.Path(paths[-1]).parent) if paths else None
log=(pathlib.Path(directory)/'process.log').read_text(errors='replace') if directory else raw
success='HARD_BENCH_PASS project=crypto-soc' in log
if negative:
    passed='FAULT_INJECTED' in log and bool(re.search(r'Fatal: FIRMWARE_FAIL run=0 code=badc0000',log)) and not success
else:passed=code==0 and success and not re.search(r'Fatal:|FATAL:|ERROR:|TIMEOUT',log)
result={'project':'crypto-soc','stage':stage,'pass':passed,'exit_code':code,
    'wall_seconds':round(time.monotonic()-start,2),'artifact_directory':directory,
    'receipt_directory':str(receipt),'other_model_api_calls':0,
    'seed_results':re.findall(r'CRYPTO_SOC_SEED_PASS [^\r\n]+',log),
    'pass_line':next((line for line in log.splitlines() if line.startswith('HARD_BENCH_PASS')),None)}
(receipt/'result.json').write_text(json.dumps(result,indent=2))
(HERE/f'latest-{stage}.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2));raise SystemExit(0 if passed else 1)
