import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';

const nonempty = x => typeof x === 'string' && x.trim().length > 0;
const strings = x => Array.isArray(x) && x.length > 0 && x.every(nonempty);
const https = x => { try { return new URL(x).protocol === 'https:'; } catch { return false; } };
const utc = x => typeof x === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/.test(x) && Number.isFinite(Date.parse(x));
export const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export function readKnowledge(root = projectRoot) {
  const read = name => JSON.parse(fs.readFileSync(path.join(root, 'knowledge', name + '.json'), 'utf8'));
  const skillRoot = path.join(root, '.pi', 'skills');
  const skills = fs.readdirSync(skillRoot, { withFileTypes: true })
    .filter(x => x.isDirectory() && x.name.startsWith('fpga-'))
    .map(x => ({ directory: path.join(skillRoot, x.name), content: fs.readFileSync(path.join(skillRoot, x.name, 'SKILL.md'), 'utf8') }));
  return { sources: read('sources'), rules: read('rules'), tools: read('tools'), sops: read('sops'), skills };
}

export function validateKnowledge(bundle, { root = projectRoot, checkPaths = true } = {}) {
  const errors = [], optional_unavailable = [];
  const check = (ok, message) => { if (!ok) errors.push(message); };
  const rows = (name, key) => {
    const doc = bundle?.[name];
    check(doc?.schema_version === 1, `${name}: unsupported schema_version`);
    check(Array.isArray(doc?.[key]) && doc[key].length > 0, `${name}: nonempty ${key} array required`);
    return Array.isArray(doc?.[key]) ? doc[key] : [];
  };
  const sourceRows = rows('sources', 'sources'), ruleRows = rows('rules', 'rules'), toolRows = rows('tools', 'tools'), sopRows = rows('sops', 'sops');
  const unique = (items, kind) => {
    const seen = new Set();
    for (const item of items) {
      check(nonempty(item?.id), `${kind}: id required`);
      check(!seen.has(item?.id), `${kind}: duplicate id ${item?.id}`);
      seen.add(item?.id);
    }
    return seen;
  };
  const sourceIds = unique(sourceRows, 'sources'), ruleIds = unique(ruleRows, 'rules'); unique(toolRows, 'tools');
  const sourceMap = new Map(sourceRows.filter(x => x && typeof x === 'object').map(x => [x.id, x]));
  const localPaths = (item, label) => {
    for (const field of ['local_paths','optional_local_paths']) {
    if (item[field] === undefined) continue;
    check(Array.isArray(item[field]), `${label}: ${field} must be an array`);
    for (const p of Array.isArray(item[field]) ? item[field] : []) {
      if (!nonempty(p)) { check(false, `${label}: invalid local path`); continue; }
      const target = path.resolve(root, p), relative = path.relative(root, target);
      check(!!relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${label}: path outside workspace ${p}`);
      if (checkPaths && !fs.existsSync(target)) {
        if (field==='optional_local_paths') optional_unavailable.push({id:label,path:p});
        else check(false, `${label}: missing local path ${p}`);
      }
    }
    }
  };
  for (const s of sourceRows) {
    if (!s || typeof s !== 'object') continue;
    for (const field of ['title', 'version', 'license', 'verification', 'local_status']) check(nonempty(s[field]), `${s.id}: source ${field} required`);
    check(https(s.url), `${s.id}: source HTTPS URL required`);
    check(https(s.license_url), `${s.id}: license HTTPS URL required`);
    check(utc(s.verified_at_utc), `${s.id}: verified_at_utc must be UTC`);
    localPaths(s, s.id);
  }
  for (const r of ruleRows) {
    if (!r || typeof r !== 'object') continue;
    check(/^FPGA-[A-Z]+-\d{3}$/.test(r.id || ''), `${r.id}: invalid rule id`);
    for (const field of ['title', 'statement', 'scope', 'static_proof_boundary', 'derivation']) check(nonempty(r[field]), `${r.id}: ${field} required`);
    for (const field of ['tags', 'versions', 'evidence_required']) check(strings(r[field]), `${r.id}: nonempty ${field} required`);
    check(['rule', 'recommendation', 'limitation'].includes(r.classification), `${r.id}: unsupported classification`);
    check(Array.isArray(r.source_refs) && r.source_refs.length > 0, `${r.id}: source_refs required`);
    for (const ref of Array.isArray(r.source_refs) ? r.source_refs : []) {
      check(sourceIds.has(ref?.source_id), `${r.id}: unknown source ${ref?.source_id}`);
      check(nonempty(ref?.section), `${r.id}: source section required`);
      check(https(ref?.url) && ref.url === sourceMap.get(ref?.source_id)?.url, `${r.id}: source URL differs from registry`);
      if (sourceMap.has(ref?.source_id)) check(Array.isArray(r.versions) && r.versions.includes(sourceMap.get(ref.source_id).version), `${r.id}: source version missing from versions`);
    }
    localPaths(r, r.id);
  }
  check(utc(bundle?.tools?.checked_at_utc), 'tools: checked_at_utc must be UTC');
  check(nonempty(bundle?.tools?.detection_boundary), 'tools: detection_boundary required');
  for (const t of toolRows) {
    if (!t || typeof t !== 'object') continue;
    for (const field of ['name', 'version', 'license', 'availability', 'integration', 'priority', 'next_step']) check(nonempty(t[field]), `${t.id}: tool ${field} required`);
    check(strings(t.evidence), `${t.id}: detection evidence required`);
    check(Array.isArray(t.source_ids), `${t.id}: source_ids array required`);
    for (const sid of Array.isArray(t.source_ids) ? t.source_ids : []) check(sourceIds.has(sid), `${t.id}: unknown tool source ${sid}`);
  }
  check(Array.isArray(bundle?.skills) && bundle.skills.length >= 3, 'skills: at least three FPGA skills required');
  const names = new Set();
  for (const skill of Array.isArray(bundle?.skills) ? bundle.skills : []) {
    const content = typeof skill?.content === 'string' ? skill.content : '';
    const label = skill?.directory || '<unknown skill>';
    const fm = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(content);
    check(!!fm, `${label}: frontmatter required`);
    const name = /^name:\s*([a-z0-9-]+)\s*$/m.exec(fm?.[1] || '')?.[1];
    check(!!name && name === path.basename(label) && name.length <= 64, `${label}: invalid skill name`);
    check(!names.has(name), `${label}: duplicate skill name`); names.add(name);
    check(/^description:\s*\S.+$/m.test(fm?.[1] || ''), `${label}: plain description required`);
    const refs = [...content.matchAll(/\bFPGA-[A-Z]+-\d{3}\b/g)].map(x => x[0]);
    check(refs.length > 0, `${label}: knowledge ID references required`);
    for (const ref of refs) check(ruleIds.has(ref), `${label}: unknown knowledge ID ${ref}`);
    for (const [, target] of content.matchAll(/\[[^\]]+\]\(([^)]+)\)/g)) {
      if (/^https:\/\//.test(target) || target.startsWith('#')) continue;
      const resolved = path.resolve(label, target.split('#')[0]);
      const relative = path.relative(root, resolved);
      check(!!relative && !relative.startsWith('..') && !path.isAbsolute(relative), `${label}: link outside workspace ${target}`);
      if (checkPaths) check(fs.existsSync(resolved), `${label}: missing skill link ${target}`);
    }
  }
  unique(sopRows,'sops');
  for (const sop of sopRows) {
    if (!sop || typeof sop!=='object') continue;
    check(nonempty(sop.title),`${sop.id}: SOP title required`);
    for (const field of ['triggers','rule_ids','required_evidence']) check(strings(sop[field]),`${sop.id}: SOP ${field} required`);
    check(sop.skill_path===`.pi/skills/${sop.id}/SKILL.md`,`${sop.id}: SOP path must match its local skill`);
    const skill=bundle.skills?.find(s=>path.basename(s.directory)===sop.id);
    check(!!skill,`${sop.id}: SOP skill missing`);
    const references=[...new Set([...(skill?.content||'').matchAll(/\bFPGA-[A-Z]+-\d{3}\b/g)].map(m=>m[0]))].sort();
    if (Array.isArray(sop.rule_ids)) {
      for (const id of sop.rule_ids) check(ruleIds.has(id),`${sop.id}: unknown SOP rule ${id}`);
      check(JSON.stringify([...sop.rule_ids].sort())===JSON.stringify(references),`${sop.id}: SOP and skill rule references differ`);
    }
  }
  for (const name of names) check(sopRows.some(s=>s?.id===name),`${name}: skill absent from SOP catalog`);
  return { valid: errors.length === 0, errors, optional_unavailable, counts: { sources: sourceRows.length, rules: ruleRows.length, tools: toolRows.length, sops:sopRows.length, skills: bundle?.skills?.length || 0 }, boundary: 'Offline structural and cross-reference validation only. Does not verify source truth, remote link reachability, HDL correctness, formal proof, tool installation or hardware behavior.' };
}

export function main() {
  try {
    const bundle = readKnowledge();
    const result = validateKnowledge(bundle);
    const paths = ['knowledge/sources.json', 'knowledge/rules.json', 'knowledge/tools.json','knowledge/sops.json', ...bundle.skills.map(s => path.relative(projectRoot, path.join(s.directory, 'SKILL.md')))];
    result.checked_at_utc = new Date().toISOString();
    result.files = paths.map(p => ({ path: p.replaceAll('\\', '/'), sha256_at_check: createHash('sha256').update(fs.readFileSync(path.join(projectRoot, p))).digest('hex') }));
    console.log(JSON.stringify(result, null, 2));
    if (!result.valid) process.exitCode = 1;
    return result;
  } catch (error) {
    console.error(JSON.stringify({ valid: false, error: String(error) }));
    process.exitCode = 1;
    return { valid: false, error: String(error) };
  }
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();
