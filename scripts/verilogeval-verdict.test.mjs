import { test } from 'node:test';
import assert from 'node:assert/strict';
import { verdict } from './verilogeval-verdict.mjs';

test('upstream timeout remains failure even when every observed sample matches', () => {
  // Regression from the recorded count_clock / lfsr32 / fancytimer runs.
  const r = verdict('TIMEOUT\nSimulation finished at 1000000 ps\nMismatches: 0 in 199999 samples');
  assert.equal(r.passed, false);
  assert.equal(r.timed_out, true);
});
test('completed sample comparison passes; wrong, empty and fatal runs do not', () => {
  assert.equal(verdict('Mismatches: 0 in 1619 samples').passed, true);
  assert.equal(verdict('Mismatches: 11 in 60 samples').passed, false);
  assert.equal(verdict('Mismatches: 0 in 0 samples').passed, false);
  assert.equal(verdict('Simulation stopped').passed, false);
  assert.equal(verdict('Fatal: assertion failed\nMismatches: 0 in 9 samples').passed, false);
});
