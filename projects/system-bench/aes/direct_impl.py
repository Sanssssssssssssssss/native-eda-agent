"""Isolate Vivado startup from the concurrently maintained native-tool wrapper."""
import datetime,hashlib,json,os,pathlib,shutil,subprocess,time
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%H%M%S')
out=ROOT/'artifacts'/f'aes-direct-{stamp}'
out.mkdir()
cmd=['E:/Xilinx/Vivado/2020.2/bin/vivado.bat','-mode','batch','-notrace','-source',
     str(HERE/'implement.tcl'),'-log','vivado.log','-journal','vivado.jou']
env=os.environ.copy();env['EDA_WORKSPACE']=str(ROOT)
shutil.copy2(HERE/'implement.tcl',out/'invoked.tcl')
shutil.copy2(HERE/'manifest.json',out/'source-manifest.json')
manifest=json.loads((HERE/'manifest.json').read_text())
for source in manifest['synthesized_source_files']+[
    'projects/system-bench/implement-common.tcl','projects/system-bench/aes/generate.py',
    'projects/system-bench/aes/direct_impl.py']:
    target=out/'inputs'/source
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copy2(ROOT/source,target)
(out/'command.json').write_text(json.dumps({'argv':cmd,'cwd':str(out)},indent=2))
start=time.monotonic()
with (out/'process.log').open('w',encoding='utf-8') as log:
    p=subprocess.Popen(cmd,cwd=out,env=env,stdin=subprocess.DEVNULL,stdout=log,stderr=subprocess.STDOUT)
    print(f'AES_DIRECT_STARTED pid={p.pid} log={out / "process.log"}',flush=True)
    while p.poll() is None and time.monotonic()-start<600:
        time.sleep(5)
    if p.poll() is None:
        subprocess.run(['taskkill.exe','/PID',str(p.pid),'/T','/F'],capture_output=True)
        p.wait()
code=p.returncode
bp=out/'build-result.json'
build=json.loads(bp.read_text()) if bp.exists() else {}
passed=code==0 and build.get('stage')=='routed' and build.get('setup_slack_ns',-1)>=0 and build.get('hold_slack_ns',-1)>=0
result={'project':'aes','stage':'impl','pass':passed,'exit_code':code,
    'wall_seconds':round(time.monotonic()-start,2),'artifact_directory':str(out),
    'receipt_directory':str(out),'launcher':'direct subprocess isolation','other_model_api_calls':0}
(out/'result.json').write_text(json.dumps(result,indent=2))
(HERE/'latest-impl.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2),flush=True)
raise SystemExit(0 if passed else 1)
