"""A deliberately flipped destination bit must be rejected by the real checker."""
import datetime,json,pathlib,re,subprocess,time
ROOT=pathlib.Path(__file__).resolve().parents[3]
HERE=pathlib.Path(__file__).resolve().parent
stamp=datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
receipt=ROOT/'artifacts'/f'system-dma-negative-{stamp}'
receipt.mkdir()
start=time.monotonic()
command=['node','scripts/eda-tool.mjs','eda_xsim',str(HERE/'negative.json')]
p=subprocess.run(command,cwd=ROOT,capture_output=True,text=True,encoding='utf-8',errors='replace')
invocation=p.stdout+p.stderr
(receipt/'invocation.log').write_text(invocation,encoding='utf-8')
match=re.search(r'^\{\s*"directory":',invocation,re.M)
data=json.loads(invocation[match.start():]) if match else {}
directory=data.get('directory')
log=(pathlib.Path(directory)/'process.log').read_text(errors='replace') if directory else invocation
rejected='NEGATIVE_INJECTION destination_bit_flipped' in log and 'DMA_DATA case=0 offset=0' in log and 'SYSTEM_BENCH_PASS' not in log
result={'project':'dma','stage':'negative_control','expected_rejection_observed':rejected,
        'fault':'one destination data bit flipped before immutable-byte checker',
        'exit_code':p.returncode,'wall_seconds':round(time.monotonic()-start,2),
        'artifact_directory':directory,'receipt_directory':str(receipt),'other_model_api_calls':0}
(receipt/'result.json').write_text(json.dumps(result,indent=2))
(HERE/'latest-negative.json').write_text(json.dumps(result,indent=2))
print(json.dumps(result,indent=2))
raise SystemExit(0 if rejected else 1)
