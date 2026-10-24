"""Run one simulation; require an explicit completion receipt, never exit code alone."""
import pathlib,json,re,subprocess,time,datetime,sys
D=pathlib.Path(__file__).resolve().parent;ROOT=D.parents[2]
mode=sys.argv[1] if len(sys.argv)>1 else 'a';assert mode in ('a','b','negative')
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
R=D/'runs'/f'{stamp}-{mode}';R.mkdir(parents=True)
start=time.monotonic()
p=subprocess.run(['node','scripts/eda-tool.mjs','eda_xsim',str(D/f'sim-{mode}.json')],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace')
text=p.stdout+'\n'+p.stderr;(R/'invocation.log').write_text(text)
m=re.search(r'^\{\s*"directory":',p.stdout,re.M)
out=pathlib.Path(json.loads(p.stdout[m.start():])['directory']) if m else None
if not out:
 m=re.search(r'inspect (.+?)\\process.log',text)
 if m:out=pathlib.Path(m.group(1))
log=(out/'process.log').read_text(errors='replace') if out else text
passed=bool(re.search(r'HARD_BENCH_PASS project=ethernet-cdc\b',log)) and not re.search(r'Fatal:|FATAL:|TIMEOUT|Error:',log)
negative=mode=='negative' and bool(re.search(r'Fatal: GMII_BYTE_MISMATCH frame=0 byte=71',log)) and 'HARD_BENCH_PASS' not in log
result={'mode':mode,'pass':(p.returncode==0 and passed) if mode!='negative' else negative,'expected_failure':mode=='negative','exit_code':p.returncode,'wall_seconds':round(time.monotonic()-start,2),'artifact_directory':str(out) if out else None,'receipt':str(R),'completion_marker':next((x for x in log.splitlines() if x.startswith('HARD_BENCH_PASS')),None),'fatal_marker':next((x for x in log.splitlines() if x.startswith('Fatal:')),None),'other_model_API_calls':0}
(R/'result.json').write_text(json.dumps(result,indent=2));(D/f'result-{mode}.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2));sys.exit(0 if result['pass'] else 1)
