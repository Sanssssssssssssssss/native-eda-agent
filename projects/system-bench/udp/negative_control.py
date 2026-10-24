"""Deliberately corrupt one expected checksum byte; require the checker to reject it."""
import json,pathlib,re,subprocess,time
D=pathlib.Path(__file__).resolve().parent;ROOT=D.parents[2]
values=(D/'tx.hex').read_text().splitlines();values[10]=f'{int(values[10],16)^1:02x}'
(D/'tx-corrupt.hex').write_text('\n'.join(values)+'\n')
tb=(D/'tb_udp.sv').read_text().replace('module tb_udp;','module tb_udp_negative;').replace((D/'tx.hex').as_posix(),(D/'tx-corrupt.hex').as_posix())
(D/'tb_udp_negative.sv').write_text(tb)
config=json.loads((D/'sim.json').read_text());config['sources'][-1]='projects/system-bench/udp/tb_udp_negative.sv';config['top']='tb_udp_negative';config['capture_top_wave']=False
(D/'negative.json').write_text(json.dumps(config,indent=2))
start=time.monotonic()
p=subprocess.run(['node','scripts/eda-tool.mjs','eda_xsim','projects/system-bench/udp/negative.json'],cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace')
(D/'negative-invocation.log').write_text(p.stdout+'\n'+p.stderr)
m=re.search(r'^\{\s*"directory":',p.stdout,re.M);data=json.loads(p.stdout[m.start():]) if m else {}
out=pathlib.Path(data['directory']) if data else None
log=(out/'process.log').read_text(errors='replace') if out else p.stdout+p.stderr
rejected=bool(re.search(r'Fatal: TX mismatch packet=0 byte=10',log)) and 'SYSTEM_BENCH_PASS' not in log
result={'test':'corrupted expected IPv4 checksum byte','negative_control_rejected':rejected,'tool_exit_code':p.returncode,'artifact_directory':str(out) if out else None,'wall_seconds':round(time.monotonic()-start,2),'other_model_api_calls':0}
(D/'negative-result.json').write_text(json.dumps(result,indent=2));print(json.dumps(result,indent=2))
raise SystemExit(0 if rejected else 1)
