import test from 'node:test';
import assert from 'node:assert/strict';
import { readKnowledge, validateKnowledge } from '../scripts/check-knowledge.mjs';

const fresh = () => structuredClone(readKnowledge());
test('checked-in sources, rules, tools and skill links are consistent', () => {
  const r = validateKnowledge(fresh());
  assert.equal(r.valid, true, r.errors.join('\n'));
  assert.ok(r.counts.rules >= 25 && r.counts.rules <= 40);
});
test('a rule cannot cite an absent source or substitute a different URL', () => {
  const b = fresh(); b.rules.rules[0].source_refs[0].source_id = 'absent';
  assert.match(validateKnowledge(b).errors.join('\n'), /unknown source absent/);
  const c = fresh(); c.rules.rules[0].source_refs[0].url = 'https://example.org/unverified';
  assert.match(validateKnowledge(c).errors.join('\n'), /source URL differs/);
});
test('rules retain applicability, version, evidence and proof boundary', () => {
  for (const field of ['scope', 'versions', 'evidence_required', 'static_proof_boundary']) {
    const b = fresh(); delete b.rules.rules[0][field];
    const r = validateKnowledge(b); assert.equal(r.valid, false, field);
    assert.ok(r.errors.some(e => e.includes(field)), r.errors.join('\n'));
  }
});
test('classification and IDs prevent silent rule promotion or duplicate retrieval', () => {
  const b = fresh(); b.rules.rules[0].classification = 'proven'; b.rules.rules.push(b.rules.rules[0]);
  const result = validateKnowledge(b).errors.join('\n');
  assert.match(result, /unsupported classification/); assert.match(result, /duplicate id/);
});
test('source provenance requires an observed version and UTC verification time', () => {
  const b = fresh(); b.sources.sources[0].version = ''; b.sources.sources[0].verified_at_utc = 'yesterday';
  const result = validateKnowledge(b).errors.join('\n');
  assert.match(result, /source version required/); assert.match(result, /must be UTC/);
});
test('skills reject broken local links and invented knowledge IDs', () => {
  const b = fresh(); b.skills[0].content += '\nFPGA-MISSING-999\n[missing](../../../knowledge/no-such-file.json)';
  const result = validateKnowledge(b).errors.join('\n');
  assert.match(result, /unknown knowledge ID FPGA-MISSING-999/); assert.match(result, /missing skill link/);
});
test('missing or malformed catalogs fail closed with diagnostics', () => {
  const r = validateKnowledge({ sources: {}, rules: { schema_version: 1, rules: [null] }, tools: {}, skills: [] });
  assert.equal(r.valid, false); assert.ok(r.errors.length >= 5);
  const b = fresh(); b.rules.rules[0].versions = {};
  assert.equal(validateKnowledge(b).valid, false);
});
test('tool availability claims retain evidence and known sources', () => {
  const b = fresh(); b.tools.tools[0].evidence = []; b.tools.tools[0].source_ids = ['unverified'];
  const result = validateKnowledge(b).errors.join('\n');
  assert.match(result, /detection evidence required/); assert.match(result, /unknown tool source unverified/);
});
