"""Deliberately corrupt one reference CRC; require the real CPU test to reject it."""
import datetime,json,pathlib,re,subprocess,time
ROOT=pathlib.Path(__file__).resolve().parents[3]
d=pathlib.Path(__file__).resolve().parent
tb=(d/'tb_soc.sv').read_text().replace('module tb_soc;','module tb_soc_bad_reference;')
needle='   seeds[0]=1;'
assert needle in tb
tb=tb.replace(needle,"   expected[0]=expected[0]^32'h1;\n"+needle)
(d/'tb_soc_bad_reference.sv').write_text(tb)
args=json.loads((d/'sim.json').read_text())
args['top']='tb_soc_bad_reference'
args['sources'][-1]='projects/system-bench/soc/tb_soc_bad_reference.sv'
args['capture_top_wave']=False
(d/'negative.json').write_text(json.dumps(args,indent=2))
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
receipt=ROOT/'artifacts'/f'system-soc-negative-{stamp}';receipt.mkdir()
start=time.monotonic()
p=subprocess.run(['node','scripts/eda-tool.mjs','eda_xsim',str(d/'negative.json')],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace')
text=p.stdout+'\n'+p.stderr
(receipt/'invocation.log').write_text(text,encoding='utf-8')
match=re.search(r'^\{\s*"directory":',p.stdout,re.M)
data=json.loads(p.stdout[match.start():]) if match else {}
out=pathlib.Path(data['directory']) if data else None
log=(out/'process.log').read_text(errors='replace') if out else text
rejected='Fatal: SOC_MISMATCH case=0 result=0' in log and 'SYSTEM_BENCH_PASS' not in log
result={'negative_control':'flip one bit of expected CRC32','correctly_rejected':rejected,'artifact_directory':str(out),'wall_seconds':round(time.monotonic()-start,2),'tool_exit_code':p.returncode,'positive_scenarios':0}
(receipt/'result.json').write_text(json.dumps(result,indent=2))
(d/'latest-negative.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
raise SystemExit(0 if rejected else 1)
