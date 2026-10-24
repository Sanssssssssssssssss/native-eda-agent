"""Prove the same scoreboard rejects a one-bit corrupted expected result."""
import datetime,json,pathlib,re,subprocess,time,sys
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
cfg=json.loads((HERE/'sim.json').read_text())
cfg['sources'].append('projects/system-bench/aes/tb_aes_negative.sv')
cfg['top']='tb_aes_negative'
cfg['capture_top_wave']=False
(HERE/'negative.json').write_text(json.dumps(cfg,indent=2))
if len(sys.argv)>1:
    out=pathlib.Path(sys.argv[1])
    old=json.loads((out/'result.json').read_text())
    exit_code=old['exit_code']; wall_seconds=old['wall_seconds']
    text=(out/'invocation.log').read_text(encoding='utf-8')
else:
    stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    out=ROOT/'artifacts'/f'system-aes-negative-{stamp}'
    out.mkdir()
    start=time.monotonic()
    p=subprocess.run(['node','scripts/eda-tool.mjs','eda_xsim',str(HERE/'negative.json')],
        cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace')
    text=p.stdout+p.stderr
    exit_code=p.returncode;wall_seconds=round(time.monotonic()-start,2)
    (out/'invocation.log').write_text(text,encoding='utf-8')
match=re.search(r'inspect ([^\r\n]+process\.log)',text)
path=pathlib.Path(match.group(1)) if match else None
result_start=re.search(r'^\{\s*"directory":',text,re.M)
if result_start:
    path=pathlib.Path(json.loads(text[result_start.start():])['process_log'])
log=path.read_text(errors='replace') if path else text
passed='Fatal: AES mismatch block=0 group=0' in log and 'SYSTEM_BENCH_PASS' not in log
result={'negative_control':'corrupt_first_expected_ciphertext_bit','correctly_rejected':passed,
    'exit_code':exit_code,'wall_seconds':wall_seconds,'verdict_uses_fatal_and_missing_pass':True,
    'process_log':str(path) if path else None,'receipt_directory':str(out),'other_model_api_calls':0}
(out/'result.json').write_text(json.dumps(result,indent=2))
(HERE/'latest-negative.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
raise SystemExit(0 if passed else 1)
