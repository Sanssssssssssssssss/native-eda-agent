import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const MAX_JSON_BYTES = 1024 * 1024;
const MAX_PAGE_BYTES = 64 * 1024;
const ROOT_JSON = new Set(['result.json', 'task-outcome.json', 'usage.json']);
const TEXT_EXTENSIONS = new Set(['.log', '.rpt', '.txt', '.csv', '.md']);
const PRIVATE_NAME = /^(?:prompt|events|messages|conversation|transcript|requests?|responses?|auth|credentials?|secrets?|tokens?|api[_-]?keys?|access[_-]?tokens?|refresh[_-]?tokens?|passwords?|passwd|client[_-]?secrets?|config|settings)(?:[._-]|$)/i;
const PRIVATE_KEYS = new Set(['authorization', 'apikey', 'apikeys', 'password', 'passwd', 'secret', 'secrets', 'credential', 'credentials', 'accesstoken', 'refreshtoken', 'idtoken', 'bearer', 'token', 'thinking', 'reasoning', 'thinkingtext', 'reasoningcontent', 'signature']);
const error = (message, statusCode = 400) => Object.assign(new Error(message), {statusCode});
const inside = (base, target) => {const relative = path.relative(base, target); return Boolean(relative) && !relative.startsWith('..') && !path.isAbsolute(relative);};

function runDirectory(root, id) {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9._-]{1,200}$/.test(id) || ['.', '..'].includes(id)) throw error('Invalid run identifier');
  const workspace = fs.realpathSync(root), artifacts = fs.realpathSync(path.join(workspace, 'artifacts'));
  if (!inside(workspace, artifacts)) throw error('Artifacts directory is outside workspace', 403);
  const directory = fs.realpathSync(path.join(artifacts, id));
  if (!inside(artifacts, directory) || !fs.statSync(directory).isDirectory()) throw error('Run directory is outside artifacts', 403);
  return directory;
}

function allowed(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\\') || relative.includes(':') || relative.includes('\0')) return false;
  const parts = relative.split('/');
  if (parts.some(part => !part || part.startsWith('.') || /^(?:inputs|requests|responses|sessions|credentials|secrets)$/i.test(part))) return false;
  const name = parts.at(-1);
  if (PRIVATE_NAME.test(name)) return false;
  const extension = path.posix.extname(name).toLowerCase();
  return TEXT_EXTENSIONS.has(extension) || (parts.length === 1 && (ROOT_JSON.has(name) || /^[a-zA-Z0-9_-]+\.result\.json$/.test(name)));
}

function resolveArtifact(directory, relative) {
  if (!allowed(relative)) throw error('This artifact is not available for preview', 403);
  const file = fs.realpathSync(path.join(directory, relative));
  const actual = path.relative(directory, file).replaceAll('\\', '/');
  if (!inside(directory, file) || !allowed(actual)) throw error('Artifact path is outside the permitted run files', 403);
  const stat = fs.statSync(file);
  if (!stat.isFile()) throw error('Artifact must be a regular file');
  const type = path.extname(actual).toLowerCase() === '.json' ? 'json' : 'text';
  return {file, stat, type};
}

export function listRunArtifacts(root, runId) {
  const directory = runDirectory(root, runId), files = [];
  let visited = 0, truncated = false;
  const walk = (relative = '', depth = 0) => {
    if (depth > 4 || visited > 2000 || files.length >= 200) {truncated = true; return;}
    for (const entry of fs.readdirSync(path.join(directory, relative), {withFileTypes: true}).sort((a, b) => a.name.localeCompare(b.name))) {
      if (++visited > 2000 || files.length >= 200) {truncated = true; break;}
      if (entry.isSymbolicLink() || entry.name.startsWith('.') || /^(?:inputs|requests|responses|sessions|credentials|secrets)$/i.test(entry.name)) continue;
      const candidate = relative ? `${relative}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {walk(candidate, depth + 1); continue;}
      if (!entry.isFile() || !allowed(candidate)) continue;
      try {
        const {stat, type} = resolveArtifact(directory, candidate), limit = type === 'json' ? MAX_JSON_BYTES : MAX_FILE_BYTES;
        files.push({file: candidate, size_bytes: stat.size, type, previewable: stat.size <= limit, max_preview_file_bytes: limit});
      } catch { /* A file removed during listing is absent from this observation. */ }
    }
  };
  walk();
  return {run_id: runId, files, truncated, page_limit_bytes: MAX_PAGE_BYTES,
    scope: 'Permitted reports and receipts only; inputs, prompts, raw conversation events and credentials are excluded.'};
}

function redactText(text, counter) {
  const replace = (_match, prefix = '') => {counter.value++; return `${prefix}[REDACTED]`;};
  return text
    .replace(/(\bauthorization\s*[:=]\s*)(?:bearer\s+|basic\s+)?[^\r\n]+/gi, replace)
    .replace(/(\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|password|passwd|client[_-]?secret)\s*[:=]\s*)["']?[^\s,"';]+["']?/gi, replace)
    .replace(/\bsk-[A-Za-z0-9_-]{12,}\b/g, match => replace(match));
}

function redactJson(value, counter) {
  if (Array.isArray(value)) return value.map(item => redactJson(item, counter));
  if (value && typeof value === 'object') {
    // Reasoning blocks can carry their text under a neutral `text` key.
    if (['thinking', 'reasoning'].includes(value.type)) {counter.value++; return {type: value.type, content: '[REDACTED]'};}
    return Object.fromEntries(Object.entries(value).map(([key, child]) => {
      if (PRIVATE_KEYS.has(key.toLowerCase().replaceAll(/[_-]/g, ''))) {counter.value++; return [key, '[REDACTED]'];}
      return [key, redactJson(child, counter)];
    }));
  }
  return typeof value === 'string' ? redactText(value, counter) : value;
}

export function readRunArtifact(root, runId, relative, {offset = 0, limit = MAX_PAGE_BYTES} = {}) {
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > MAX_PAGE_BYTES) throw error('Invalid artifact page offset or size');
  const directory = runDirectory(root, runId), {file, stat, type} = resolveArtifact(directory, relative);
  const maximum = type === 'json' ? MAX_JSON_BYTES : MAX_FILE_BYTES;
  if (stat.size > maximum) throw error(`Artifact exceeds the ${maximum} byte preview limit; inspect the original local file`, 413);
  const bytes = fs.readFileSync(file);
  if (bytes.length > maximum) throw error('Artifact grew beyond the preview size limit', 413);
  const sha256 = createHash('sha256').update(bytes).digest('hex');
  const encoding = bytes[0] === 0xff && bytes[1] === 0xfe ? 'utf16le' : 'utf8';
  let text = bytes.toString(encoding).replace(/^\uFEFF/, '');
  if (text.includes('\0')) throw error('Binary content cannot be previewed');
  const counter = {value: 0};
  if (type === 'json') {
    let value; try {value = JSON.parse(text);} catch {throw error('JSON receipt is incomplete or malformed');}
    text = JSON.stringify(redactJson(value, counter), null, 2) + '\n';
  } else text = redactText(text, counter);
  const display = Buffer.from(text, 'utf8');
  if (offset > display.length) throw error('Artifact offset is outside the preview', 416);
  let start = offset, end = Math.min(display.length, offset + limit);
  // Byte cursors always finish at a UTF-8 boundary; Chinese text is never cut mid-character.
  while (start < display.length && (display[start] & 0xc0) === 0x80) start++;
  while (end > start && end < display.length && (display[end] & 0xc0) === 0x80) end--;
  if (end === start && end < display.length) {end++; while (end < display.length && (display[end] & 0xc0) === 0x80) end++;}
  const content = display.subarray(start, end).toString('utf8');
  return {run_id: runId, file: relative, type, content, text: content, encoding,
    original_size_bytes: bytes.length, total_bytes: display.length, offset: start,
    next_offset: end < display.length ? end : null, truncated: end < display.length,
    sha256, redacted: counter.value > 0, redaction_count: counter.value,
    offset_basis: 'Redacted UTF-8 preview bytes; sha256 is the unchanged original file.',
    scope: 'Preview does not establish engineering acceptance or modify the original artifact.'};
}

export const previewRunArtifact = readRunArtifact;
