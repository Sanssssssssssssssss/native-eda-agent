import test from 'node:test';
import assert from 'node:assert/strict';
import {assessLifecycleTap,lifecycleCoverage,sessionExecutionEligibility} from '../src/evaluation-contracts.mjs';

// TAP text is synthetic protocol input; these assertions are not live benchmark scores.
function tap() {
  let i=0;
  return ['TAP version 13',...Object.entries(lifecycleCoverage).flatMap(([category,count])=>
    Array.from({length:count},(_,n)=>`ok ${++i} - ${category}: scenario ${n+1}`)),
    '1..12','# tests 12','# suites 0','# pass 12','# fail 0','# cancelled 0','# skipped 0','# todo 0'].join('\n');
}
test('lifecycle evaluator requires a complete passing plan and every required category',()=>{
  assert.equal(assessLifecycleTap(tap(),0).status,'passed');
  for(const changed of ['',tap().replace('ok 12 - context: scenario 1\n',''),tap().replace('context:','unknown:'),tap().replace('1..12','1..11'),tap().replace('# tests 12','# tests 11')])
    assert.equal(assessLifecycleTap(changed,0).status,'failed');
  assert.equal(assessLifecycleTap(tap(),1).status,'failed');
});
test('skips, TODO, duplicate scenarios and failure summaries cannot count as full coverage',()=>{
  for(const changed of [tap().replace('ok 1 - isolation: scenario 1','ok 1 - isolation: scenario 1 # SKIP'),
    tap().replace('ok 1 - isolation: scenario 1','ok 1 - isolation: scenario 1 # TODO'),
    tap().replace('integrity: scenario 2','integrity: scenario 1'),tap().replace('# fail 0','# fail 1'),
    tap().replace('ok 12 -','not ok 12 -'),tap().replace('# todo 0','# todo 1')])
    assert.equal(assessLifecycleTap(changed,0).status,'failed');
});
test('online eligibility uses factory and prompt-time event evidence, not provider labels',()=>{
  const manifest={provider:'deepseek',model:'model-name',execution_provenance:{schema_version:1,session_factory:'builtin_pi_sdk'},
    provider_observation:{assistant_messages:1,successful_assistant_messages:1}};
  const events=[{type:'run_start',execution_provenance:manifest.execution_provenance},{type:'prompt_start'},
    {type:'message_end',message:{role:'assistant',stopReason:'stop'}}];
  assert.equal(sessionExecutionEligibility(manifest,events).eligible,true);
  assert.equal(sessionExecutionEligibility({...manifest,execution_provenance:{schema_version:1,session_factory:'injected'}},events).reason,'injected_session_not_live');
  assert.equal(sessionExecutionEligibility({...manifest,execution_provenance:undefined},events).reason,'session_execution_origin_unknown');
  for(const missing of [[],events.slice(1),events.slice(0,2)])assert.equal(sessionExecutionEligibility(manifest,missing).eligible,false);
  assert.equal(sessionExecutionEligibility({...manifest,provider_observation:{assistant_messages:999,successful_assistant_messages:1}},events).eligible,false);
});
