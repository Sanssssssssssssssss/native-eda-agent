"""Local optimizer entry. Use through eda_vivado_optimize for shared scheduling."""
import argparse
import asyncio
import json
from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'src'))
from fpga_optimizer.runner import optimize
from fpga_optimizer.backend import LocalVivado


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', required=True)
    parser.add_argument('--output', required=True)
    parser.add_argument('--vivado', required=True)
    parser.add_argument('--trace-context')
    parser.add_argument('--recovery')
    args = parser.parse_args()
    request = json.loads(Path(args.request).read_text(encoding='utf-8'))
    context = json.loads(Path(args.trace_context).read_text(encoding='utf-8')) if args.trace_context else None
    recovery = json.loads(Path(args.recovery).read_text(encoding='utf-8')) if args.recovery else None
    result = asyncio.run(optimize(request, args.output, lambda out: LocalVivado(out, args.vivado), trace_context=context, recovery=recovery))
    print(json.dumps({'status': result['status'], 'result': str(Path(args.output) / 'optimizer-result.json'),
                      'model_api_calls': 0}, ensure_ascii=False))
    if result['status'] in ('failed', 'blocked_by_baseline'):
        raise SystemExit(2)


if __name__ == '__main__':
    main()
