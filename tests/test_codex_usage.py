import importlib.util
import json
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('codex_usage', Path(__file__).resolve().parents[1] / 'scripts/capture-codex-usage.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class UsageTest(unittest.TestCase):
    def test_counter_delta_ignores_limits_and_partial_line(self):
        with tempfile.TemporaryDirectory() as directory:
            log = Path(directory) / 'session.jsonl'
            rows = [{'timestamp': stamp, 'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {'total_token_usage': {'input_tokens': value, 'cached_input_tokens': value - 1, 'output_tokens': 5}}}} for stamp, value in [('2026-10-22T00:00:00.000Z', 100), ('2026-10-22T00:00:02.000Z', 170)]]
            log.write_text('\n'.join(map(json.dumps, rows)) + '\n{', encoding='utf-8')
            data = module.capture(log, '2026-10-22T00:00:01.000Z')
            self.assertEqual(data['window_delta']['input_tokens'], 70)
            self.assertEqual(data['partial_json_lines'], 1)
            self.assertIsNone(module.capture(log, '2026-10-21T00:00:00.000Z')['window_delta'])
            self.assertIsNone(module.capture(log, '2026-10-23T00:00:00.000Z')['window_delta'])


if __name__ == '__main__':
    unittest.main()
