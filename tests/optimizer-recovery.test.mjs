import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { createTrace,runProcess } from '../src/trace.mjs';
import { createRunState } from '../src/runtime.mjs';
import { prepareRecovery } from '../src/optimizer-recovery.mjs';
import { inspectTrace } from '../scripts/trace-inspect.mjs';
import { exportTraces } from '../src/trace-export.mjs';
const root=path.resolve(import.meta.dirname,'..'), python=path.join(root,'runtime/vivado-community-venv/Scripts/python.exe');
const sha=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixture=`import asyncio,json,sys
from pathlib import Path
sys.path[:0]=[sys.argv[1]+'/src',sys.argv[1]+'/tests']
from fpga_optimizer.runner import optimize
from test_fpga_optimizer import FakeBackend,measured
from unittest.mock import patch
winner=measured(wns_ns=0.4)
class Backend(FakeBackend):
    async def measure(self,checkpoint,directory,play=None,timeout=180):
        if sys.argv[5]=='interrupt' and play=='route_aggressive': raise asyncio.CancelledError()
        if Path(directory).name=='recovered-best': return (measured(wns_ns=0.3) if sys.argv[5]=='bad-resume' else winner),Path(checkpoint)
        return await super().measure(checkpoint,directory,play,timeout)
async def run():
    with patch('socket.socket.connect',side_effect=AssertionError('network forbidden')):
        recovery=json.loads(Path(sys.argv[6]).read_text(encoding='utf8')) if sys.argv[5]!='interrupt' else None
        await optimize({'checkpoint':sys.argv[2],'mode':'run','max_trials':3},sys.argv[3],
          lambda _:Backend([winner] if recovery is None else [measured(wns_ns=0.3)],final=winner),
          trace_context=json.loads(sys.argv[4]),recovery=recovery)
try: asyncio.run(run())
except asyncio.CancelledError: pass`;

test('interrupted candidate recovers committed winner in a new run; live ownership/hash/code checks fail closed', {timeout:30000},async()=>{
  const source=createTrace({root,tool:'eda_vivado_optimize',args:{test:'synthetic-only'},toolCallId:'recovery-source'});
  const state=createRunState(root,source);
  for(const status of ['preflight','snapshotting','waiting','running']) state.transition(status);
  const input=path.join(source.directory,'input.dcp'); fs.writeFileSync(input,'SYNTHETIC'); source.capture(input,'fixture');
  const context=t=>JSON.stringify({trace_id:t.manifest.trace_id,parent_span_id:t.manifest.span_id,parent_run_id:t.manifest.run_id});
  source.event('optimizer_link',{});
  await runProcess(source,python,['-c',fixture,root,input,path.join(source.directory,'optimizer'),context(source),'interrupt']);
  source.finish('cancelled'); state.transition('cancelled');
  let checked=prepareRecovery(root,source.directory); assert.equal(checked.ready,true,JSON.stringify(checked.issues));
  assert.deepEqual(checked.remaining_plays,['route_aggressive','route_more_global']);
  const journalFile=path.join(source.directory,'optimizer/recovery.json'), originalJournal=fs.readFileSync(journalFile);
  const oldBest=checked.journal.best.checkpoint, bestBytes=fs.readFileSync(oldBest);
  const stateFile=path.join(root,'.eda-state/runs',`${source.manifest.run_id}.json`), oldState=fs.readFileSync(stateFile);
  try {
    fs.writeFileSync(oldBest,'CORRUPTED'); assert.equal(prepareRecovery(root,source.directory).ready,false); fs.writeFileSync(oldBest,bestBytes);
    const active=JSON.parse(oldState); active.status='running'; active.pid=process.pid; fs.writeFileSync(stateFile,JSON.stringify(active));
    assert.equal(prepareRecovery(root,source.directory).ready,false); fs.writeFileSync(stateFile,oldState);
    const changed=JSON.parse(originalJournal); changed.code_hashes['src/fpga_optimizer/core.py']='0'.repeat(64); fs.writeFileSync(journalFile,JSON.stringify(changed));
    assert.equal(prepareRecovery(root,source.directory).ready,false); fs.writeFileSync(journalFile,originalJournal);
  } finally {fs.writeFileSync(oldBest,bestBytes);fs.writeFileSync(journalFile,originalJournal);fs.writeFileSync(stateFile,oldState);}
  checked=prepareRecovery(root,source.directory);
  const before=sha(journalFile), recovered=createTrace({root,tool:'eda_vivado_optimize',args:{test:'synthetic-only'},toolCallId:'recovery-target'});
  const proof=path.join(recovered.directory,'recovery-input.json');fs.writeFileSync(proof,JSON.stringify(checked));recovered.capture(proof,'recovery');recovered.event('optimizer_link',{});
  await runProcess(recovered,python,['-c',fixture,root,checked.journal.baseline.checkpoint,path.join(recovered.directory,'optimizer'),context(recovered),'resume',proof]);
  recovered.finish('completed');
  const result=JSON.parse(fs.readFileSync(path.join(recovered.directory,'optimizer/optimizer-result.json')));
  assert.equal(result.recovery.inherited_candidates,1); assert.equal(result.attempts.length,1); assert.equal(result.attempts[0].play,'route_aggressive');
  assert.equal(result.wns_gain_ns,0.2); assert.equal(result.winner_recheck.passed,true); assert.equal(sha(journalFile),before);
  const report=inspectTrace(recovered.directory);assert.equal(report.valid,true,JSON.stringify(report.validation_issues));
  const exported=exportTraces([recovered.directory]); assert.ok(exported.summary.span_count>=5);
  const rejected=createTrace({root,tool:'eda_vivado_optimize',args:{test:'synthetic-only'},toolCallId:'recovery-negative'});
  rejected.capture(proof,'recovery');rejected.event('optimizer_link',{});
  await assert.rejects(runProcess(rejected,python,['-c',fixture,root,checked.journal.baseline.checkpoint,path.join(rejected.directory,'optimizer'),context(rejected),'bad-resume',proof]));
  rejected.finish('failed');
  const badResult=JSON.parse(fs.readFileSync(path.join(rejected.directory,'optimizer/optimizer-result.json')));
  assert.equal(badResult.status,'failed');assert.equal(badResult.attempts.length,0);
  assert.ok(fs.existsSync(path.join(rejected.directory,'optimizer/recovered-best/measurement.json')));
  assert.equal(inspectTrace(rejected.directory).valid,true);
  console.log(`Synthetic recovery evidence: ${source.directory} -> ${recovered.directory}`);
});
