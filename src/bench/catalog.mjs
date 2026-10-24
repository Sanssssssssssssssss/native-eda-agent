import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { GENERATOR_FAMILIES } from './generators.mjs';
export const defaultRoot = path.resolve(import.meta.dirname, '../..');
export const hash = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
const tools = ['eda_xsim', 'eda_vivado', 'eda_ltspice_batch', 'node_test'];
export function validateCatalog(catalog) {
  const errors = [];
  const require = (ok, error) => { if (!ok) errors.push(error); };
  require(catalog?.schema_version === 1, 'schema_version must be 1');
  require(typeof catalog?.catalog_version === 'string' && catalog.catalog_version.length > 0, 'catalog_version required');
  require(Array.isArray(catalog?.categories) && Array.isArray(catalog?.tiers) && Array.isArray(catalog?.cases), 'categories, tiers and cases must be arrays');
  const categories = Array.isArray(catalog?.categories) ? catalog.categories : [];
  const tiers = Array.isArray(catalog?.tiers) ? catalog.tiers : [];
  require(new Set(categories).size === categories.length && categories.every(value => typeof value === 'string'), 'categories must be unique strings');
  require(new Set(tiers).size === tiers.length && tiers.every(value => ['smoke', 'light', 'system', 'implementation', 'external'].includes(value)), 'tiers must be unique supported values');
  const ids = new Set();
  for (const item of Array.isArray(catalog?.cases) ? catalog.cases : []) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) { errors.push('case must be an object'); continue; }
    const id = item.id || '<missing>';
    require(/^[A-Za-z0-9_-]+$/.test(item.id || '') && !ids.has(id), `${id}: invalid or duplicate id`); ids.add(id);
    for (const key of ['family', 'variant', 'title']) require(typeof item[key] === 'string' && item[key].length > 0, `${id}: ${key} required`);
    require(categories.includes(item.category), `${id}: unknown category`);
    require(tiers.includes(item.tier), `${id}: unknown tier`);
    require(tools.includes(item.tool), `${id}: unsupported tool`);
    require(['existing', 'generated', 'external'].includes(item.origin), `${id}: invalid origin`);
    require(['runnable', 'external_not_downloaded'].includes(item.availability), `${id}: invalid availability`);
    require(Number.isSafeInteger(item.seed) && item.seed >= 0 && item.seed <= 0xffffffff, `${id}: invalid seed`);
    require(Number.isSafeInteger(item.timeout_ms) && item.timeout_ms > 0 && item.timeout_ms <= 900000, `${id}: invalid timeout`);
    require(['tool', 'call_file', 'generated', 'verilogeval', 'fft', 'invalid_rtl', 'node_test', 'timeout_fixture', 'external'].includes(item.input?.kind), `${id}: unsupported input`);
    require(['marker', 'rc', 'verilogeval', 'routed', 'fft', 'expected_failure', 'expected_timeout', 'node_tests'].includes(item.acceptance?.kind), `${id}: unsupported acceptance`);
    if (item.input?.kind === 'generated') require(GENERATOR_FAMILIES.includes(item.input.generator) && [4, 8].includes(item.input.width) && item.input.samples >= 16 && item.input.samples <= 256, `${id}: invalid generator config`);
    if (['expected_failure', 'expected_timeout'].includes(item.acceptance?.kind)) require(item.negative_control === true, `${id}: negative acceptance must be labelled`);
    if (item.acceptance?.kind === 'expected_failure') require(typeof item.acceptance.error_pattern === 'string' && item.acceptance.error_pattern.length > 0, `${id}: rejection pattern required`);
    if (item.origin === 'external') require(item.availability !== 'runnable' && item.input?.kind === 'external', `${id}: external placeholder cannot be runnable`);
    for (const key of ['pattern', 'error_pattern']) if (item.acceptance?.[key] !== undefined) { try { new RegExp(item.acceptance[key]); } catch { errors.push(`${id}: invalid ${key}`); } }
    if (item.acceptance?.kind === 'marker') require(typeof item.acceptance.pattern === 'string' && item.acceptance.pattern.length > 0, `${id}: completion pattern required`);
    if (item.acceptance?.kind === 'rc') require(Array.isArray(item.acceptance.names) && item.acceptance.names.length > 0 && item.acceptance.names.every(name => ['cutoff_hz', 'gain_1k', 'v_at_tau', 'v_final'].includes(name)) && item.acceptance.relative_tolerance > 0 && item.acceptance.relative_tolerance <= 0.002, `${id}: invalid RC policy`);
    if (['call_file', 'node_test', 'timeout_fixture'].includes(item.input?.kind)) require(typeof item.input.path === 'string' && item.input.path.length > 0, `${id}: input path required`);
    if (item.input?.kind === 'tool') {
      const args = item.input.args;
      require(args && typeof args === 'object' && !Array.isArray(args), `${id}: tool args required`);
      if (item.tool === 'eda_xsim') require(Array.isArray(args?.sources) && args.sources.length > 0 && args.sources.every(file => typeof file === 'string') && typeof args?.top === 'string', `${id}: xsim sources and top required`);
      if (item.tool === 'eda_vivado') require(typeof args?.script === 'string', `${id}: Vivado script required`);
      if (item.tool === 'eda_ltspice_batch') require(typeof args?.netlist === 'string', `${id}: SPICE netlist required`);
    }
    if (item.input?.kind === 'verilogeval') require(typeof item.input.project === 'string' && /^[A-Za-z0-9_]+$/.test(item.input.task || ''), `${id}: invalid VerilogEval input`);
    if (item.input?.kind === 'fft') require(['simulation', 'implementation'].includes(item.input.stage), `${id}: invalid FFT stage`);
  }
  return { valid: errors.length === 0, errors, case_count: catalog?.cases?.length || 0 };
}
export function loadCatalog(root = defaultRoot) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, 'benchmarks/catalog.json'), 'utf8'));
  const validation = validateCatalog(catalog);
  if (!validation.valid) throw new Error(validation.errors.join('\n'));
  return catalog;
}
function filterValues(value) { return value === undefined ? null : Array.isArray(value) ? value : String(value).split(',').filter(Boolean); }
export function selectCases(catalog, options = {}) {
  const filters = Object.fromEntries(['category', 'tier', 'tool', 'ids'].map(key => [key, filterValues(options[key])]));
  for (const [key, values] of Object.entries(filters)) if (values) {
    const allowed = key === 'ids' ? catalog.cases.map(item => item.id) : key === 'category' ? catalog.categories : key === 'tier' ? catalog.tiers : tools;
    for (const value of values) if (!allowed.includes(value)) throw new Error(`Unknown ${key}: ${value}`);
  }
  return catalog.cases.filter(item => Object.entries(filters).every(([key, values]) => !values || values.includes(item[key === 'ids' ? 'id' : key])));
}
export function listCases(options = {}) {
  const catalog = loadCatalog(options.root), cases = selectCases(catalog, options);
  return { catalog_version: catalog.catalog_version, catalog_sha256: hash(catalog), case_count: cases.length,
    family_count: new Set(cases.map(item => item.family)).size, categories: catalog.categories, tiers: catalog.tiers,
    cases, note: 'Variants and seeds belong to their named family; counts are not independent benchmark questions.' };
}
export function checkedPath(root, relative) {
  const full = path.resolve(root, relative);
  const rel = path.relative(path.resolve(root), full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) throw new Error(`Path outside workspace: ${relative}`);
  if (fs.existsSync(full)) {
    const real = fs.realpathSync(full), realRel = path.relative(fs.realpathSync(root), real);
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) throw new Error(`Resolved path outside workspace: ${relative}`);
  }
  return full;
}
