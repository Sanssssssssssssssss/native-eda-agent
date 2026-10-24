"""Read-only Codex token counters for explicitly selected local sessions.

Outputs counters, timestamps and provenance only, never chat bodies or account limits.
Cached input and reasoning output are subsets, not extra tokens to add again.
"""
import argparse
import datetime as dt
import json
from pathlib import Path
import sqlite3


def capture(path, since=None):
    baseline = None
    latest = None
    partial_lines = 0
    with Path(path).open(encoding='utf-8') as stream:
        for line in stream:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                partial_lines += 1
                continue
            payload = row.get('payload', {})
            usage = (payload.get('info') or {}).get('total_token_usage')
            if row.get('type') != 'event_msg' or payload.get('type') != 'token_count' or not usage:
                continue
            point = {'timestamp_utc': row['timestamp'], 'counters': usage}
            if since and row['timestamp'] < since:
                baseline = point
            latest = point
    delta = None
    if baseline and latest and (not since or latest['timestamp_utc'] >= since):
        delta = {key: latest['counters'].get(key, 0) - value for key, value in baseline['counters'].items()}
        if any(value < 0 for value in delta.values()):
            delta = None
    return {'source_rollout': str(path), 'requested_since_utc': since, 'baseline': baseline,
            'latest': latest, 'window_delta': delta, 'partial_json_lines': partial_lines,
            'scope': 'Session counters as of last recorded event; no inferred final-turn tokens.',
            'window_note': 'Delta is unavailable without a valid preceding counter; session totals are not a window estimate.'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--thread', action='append', required=True)
    parser.add_argument('--since', help='UTC ISO timestamp; requires a preceding usage counter for delta')
    parser.add_argument('--database', default=str(Path.home() / '.codex/state_5.sqlite'))
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    if args.since:
        args.since = dt.datetime.fromisoformat(args.since.replace('Z', '+00:00')).astimezone(dt.timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z')
    result = {'captured_at_utc': dt.datetime.now(dt.timezone.utc).isoformat(), 'sessions': [],
              'cost': None, 'cost_note': 'Local token counters are not billing records.',
              'counting_note': 'cached_input_tokens is part of input_tokens; reasoning_output_tokens is part of output_tokens.'}
    with sqlite3.connect(Path(args.database).resolve().as_uri() + '?mode=ro', uri=True) as conn:
        conn.row_factory = sqlite3.Row
        for thread in dict.fromkeys(args.thread):
            row = conn.execute('select id,agent_path,model,reasoning_effort,rollout_path from threads where id=?', (thread,)).fetchone()
            if row is None:
                result['sessions'].append({'thread_id': thread, 'status': 'missing'})
                continue
            value = capture(row['rollout_path'], args.since)
            value.update({'thread_id': row['id'], 'agent_path': row['agent_path'], 'model': row['model'], 'reasoning_effort': row['reasoning_effort']})
            result['sessions'].append(value)
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(output)


if __name__ == '__main__':
    main()
