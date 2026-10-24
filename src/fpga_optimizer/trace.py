"""Local causal trace. No prompts, credentials, telemetry SDK or network calls."""
from contextlib import contextmanager
from contextvars import ContextVar
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import time
from uuid import uuid4


class OptimizerTrace:
    def __init__(self, directory, context=None):
        context = context or {}
        for field, length in [('trace_id', 32), ('parent_span_id', 16)]:
            if context.get(field) is not None and not re.fullmatch('(?!0+$)[0-9a-f]{' + str(length) + '}', context[field]):
                raise ValueError(f'Invalid {field}')
        self.directory = Path(directory)
        self.file = self.directory / 'optimizer-events.jsonl'
        self.seq = 0
        self.run_id = 'optimizer-' + uuid4().hex
        self.trace_id = context.get('trace_id') or uuid4().hex
        self.span_id = uuid4().hex[:16]
        self.parent_span_id = context.get('parent_span_id')
        self.parent_run_id = context.get('parent_run_id')
        self.active = ContextVar('optimizer_span', default=(self.span_id, self.parent_span_id))
        self.start = time.monotonic()

    def metadata(self):
        return dict(schema_version=1, run_id=self.run_id, trace_id=self.trace_id,
                    span_id=self.span_id, parent_span_id=self.parent_span_id,
                    parent_run_id=self.parent_run_id, events_file=str(self.file))

    def event(self, kind, **details):
        span, parent = self.active.get()
        self.seq += 1
        event = {**details, 'schema_version': 1, 'seq': self.seq, 'run_id': self.run_id,
                 'trace_id': self.trace_id, 'span_id': span, 'parent_span_id': parent,
                 'timestamp_utc': datetime.now(timezone.utc).isoformat(), 'type': kind,
                 'elapsed_ms': round((time.monotonic() - self.start) * 1000, 3)}
        with self.file.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(event, ensure_ascii=False, allow_nan=False) + '\n')
            stream.flush()
            os.fsync(stream.fileno())

    @contextmanager
    def span(self, name, **details):
        token = self.active.set((uuid4().hex[:16], self.active.get()[0]))
        start = time.monotonic()
        self.event('span_start', name=name, **details)
        try:
            yield
        except BaseException as exc:
            self.event('span_end', name=name, status='cancelled' if type(exc).__name__ == 'CancelledError' else 'failed',
                       error_type=type(exc).__name__, duration_ms=round((time.monotonic() - start) * 1000, 3))
            raise
        else:
            self.event('span_end', name=name, status='completed', duration_ms=round((time.monotonic() - start) * 1000, 3))
        finally:
            self.active.reset(token)

    def evidence(self, file, role):
        file = Path(file).resolve(strict=True)
        relative = file.relative_to(self.directory.resolve())
        hasher = hashlib.sha256()
        with file.open('rb') as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b''):
                hasher.update(block)
        self.event('evidence', path=relative.as_posix(), role=role,
                   sha256=hasher.hexdigest(), bytes=file.stat().st_size)
