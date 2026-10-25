import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { readConfig } from './runtime.mjs';
import { edaResourceOptions, skillDirectories } from './agent-resources.mjs';

const save = (file, data) => fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n');
const hash = value => createHash('sha256').update(value).digest('hex');

// Only public output crosses the workbench boundary. Raw SDK events remain in the local trace.
export function publicAgentEvent(event) {
  if (event.type === 'message_update') {
    const delta = event.assistantMessageEvent;
    return delta?.type === 'text_delta' ? { type: 'text_delta', text: delta.delta } : null;
  }
  if (event.type === 'message_end') {
    if (event.message?.role !== 'assistant') return null;
    return { type: 'assistant_message', text: (event.message.content || []).filter(c => c.type === 'text').map(c => c.text).join('\n'), stopReason: event.message.stopReason };
  }
  if (['tool_execution_start', 'tool_execution_end'].includes(event.type)) {
    return { type: event.type, toolName: event.toolName, toolCallId: event.toolCallId, isError: event.isError, durationMs: event.durationMs };
  }
  if (['run_start', 'resources_loaded', 'session_ready', 'run_end', 'auto_retry_start', 'auto_retry_end', 'auto_compaction_start', 'auto_compaction_end'].includes(event.type)) {
    return { type: event.type, status: event.status, phase: event.phase, attempt: event.attempt, success: event.success, stoppedReason: event.stoppedReason };
  }
  return null;
}

async function createPiSession({ root, agentDir, resumeSessionFile, traceContext }) {
  // Lazy imports and resource loading happen only after the explicit model gate.
  const sdk = await import('@earendil-works/pi-coding-agent');
  const { createJiti } = await import('jiti');
  const extension = await createJiti(import.meta.url).import(path.join(root, 'src/extension.ts'), { default: true });
  const settingsManager = sdk.SettingsManager.create(root, agentDir);
  const loader = new sdk.DefaultResourceLoader(edaResourceOptions({ root, agentDir, settingsManager,
    extensionFactories: [pi => extension(pi, { traceContext }), sdk.createCodemodeExtension({ mode: 'on' }), sdk.createToolSearchExtension(), sdk.createMcpExtension()],
  }));
  await loader.reload();
  const sessions = path.join(root, '.eda-state/pi-sessions');
  fs.mkdirSync(sessions, { recursive: true });
  const sessionManager = resumeSessionFile ? sdk.SessionManager.open(resumeSessionFile, sessions, root) : sdk.SessionManager.create(root, sessions);
  const result = await sdk.createAgentSession({ cwd: root, agentDir, settingsManager, resourceLoader: loader, sessionManager });
  return { ...result, resources: { skills: loader.getSkills().skills.map(s => ({ name: s.name, path: path.relative(root, s.filePath).replaceAll('\\', '/') })) } };
}

function checkedResume(root, file) {
  if (!file) return undefined;
  const directory = fs.realpathSync(path.join(root, '.eda-state/pi-sessions'));
  const target = fs.realpathSync(path.resolve(root, file));
  const relative = path.relative(directory, target);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative) || !target.endsWith('.jsonl')) throw new Error('Pi session must belong to this workspace session directory');
  const header = JSON.parse(fs.readFileSync(target, 'utf8').split('\n')[0]);
  if (header.type !== 'session' || fs.realpathSync(header.cwd) !== fs.realpathSync(root)) throw new Error('Pi session workspace mismatch');
  return target;
}

export async function runAgentSession({ root, prompt, limits = { maxTurns: 24, timeoutSeconds: 600 }, signal, onEvent = () => {}, resumeSessionFile, sessionFactory = createPiSession }) {
  root = path.resolve(root);
  if (readConfig(root).model_api_enabled !== true) throw new Error('Model API is disabled in .eda/config.json');
  if (typeof prompt !== 'string' || !prompt.trim() || prompt.length > 32000) throw new Error('Supply a nonempty prompt of at most 32000 characters');
  if (!Number.isSafeInteger(limits.maxTurns) || limits.maxTurns < 1 || limits.maxTurns > 100 || !Number.isSafeInteger(limits.timeoutSeconds) || limits.timeoutSeconds < 1 || limits.timeoutSeconds > 3600) throw new Error('Invalid agent limits');
  resumeSessionFile = checkedResume(root, resumeSessionFile);
  const directory = path.join(root, 'artifacts', `native-agent-${new Date().toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 6)}`);
  fs.mkdirSync(directory, { recursive: true });
  const started = performance.now();
  const run = { schemaVersion: 1, runId: path.basename(directory), mode: 'pi-sdk-agent', workspace: root, startedAt: new Date().toISOString(), status: 'initializing', limits, nodeVersion: process.version,
    inputSnapshotScope: 'Listed orchestration files only; tool runs record their own dependencies.', inputs: [], resumed: Boolean(resumeSessionFile) };
  run.trace_id = hash(run.runId).slice(0, 32); run.span_id = hash(`span:${run.runId}`).slice(0, 16);
  fs.writeFileSync(path.join(directory, 'prompt.txt'), prompt);
  const skillInputs = skillDirectories.flatMap(relative => fs.existsSync(path.join(root, relative)) ? fs.readdirSync(path.join(root, relative), { recursive: true }).filter(file => fs.statSync(path.join(root, relative, file)).isFile()).map(file => path.join(relative, file)) : []);
  const orchestration = ['src/agent.mjs', 'src/agent-session.mjs', 'src/task-context.mjs', 'src/task-outcome.mjs', 'src/workflow.mjs', 'src/agent-resources.mjs', 'src/knowledge.mjs', 'scripts/check-knowledge.mjs', 'knowledge/sops.json', 'knowledge/tools.json', 'src/extension.ts', 'src/platform.mjs', 'src/runtime.mjs', 'src/tools/eda.ts', 'src/tools/fpga.mjs', 'src/tools/optimizer.mjs', 'src/optimizer-inspection.mjs', 'src/fpga_optimizer/trace.py', 'src/fpga_optimizer/runner.py', 'src/fpga_optimizer/core.py', 'src/fpga_optimizer/backend.py', 'src/tools/vivado-common.tcl', 'src/tools/xsim-options.mjs', 'src/trace.mjs', 'package.json', 'package-lock.json', '.eda/config.json', '.pi/APPEND_SYSTEM.md', '.pi/settings.json', 'knowledge/rules.json', 'knowledge/sources.json', 'benchmarks/catalog.json'];
  for (const relative of [...orchestration, ...skillInputs]) {
    const source = path.join(root, relative);
    if (!fs.existsSync(source)) continue;
    const bytes = fs.readFileSync(source), snapshot = path.join('inputs', relative);
    fs.mkdirSync(path.dirname(path.join(directory, snapshot)), { recursive: true });
    fs.writeFileSync(path.join(directory, snapshot), bytes);
    run.inputs.push({ path: relative, snapshot, sha256: hash(bytes) });
  }
  if (resumeSessionFile) {
    const bytes = fs.readFileSync(resumeSessionFile);
    fs.writeFileSync(path.join(directory, 'session-before.jsonl'), bytes);
    run.sessionBefore = { snapshot: 'session-before.jsonl', sha256: hash(bytes) };
  }
  save(path.join(directory, 'run.json'), run);
  const events = fs.openSync(path.join(directory, 'events.jsonl'), 'a');
  let sequence = 0, publicSequence = 0, session, unsubscribe = () => {}, timer, turns = 0, failure = null, stoppedReason = null, answer = '', promptStarted = false;
  const record = event => {
    const timestamp = new Date().toISOString();
    fs.writeSync(events, JSON.stringify({ ...event, schema_version: 1, timestamp_utc: timestamp, seq: ++sequence, sequence, run_id: run.runId, agent_run_id: run.runId, session_id: run.sessionId, trace_id: run.trace_id, span_id: run.span_id, parent_span_id: null }) + '\n');
    const visible = publicAgentEvent(event);
    if (visible) { try { onEvent({ ...visible, sequence: ++publicSequence, timestamp_utc: timestamp, run_id: run.runId }); } catch { /* UI disconnect cannot corrupt the owned run. */ } }
  };
  const abort = reason => { stoppedReason ||= reason; if (session) Promise.resolve().then(() => session.abort?.()).catch(() => {}); };
  const onAbort = () => abort('user-interrupt');
  signal?.addEventListener('abort', onAbort, { once: true });
  if (signal?.aborted) onAbort();
  record({ type: 'run_start', phase: 'initializing', limits });
  let usage;
  try {
    timer = setTimeout(() => abort('wall-time-limit'), limits.timeoutSeconds * 1000);
    if (!stoppedReason) {
      const created = await sessionFactory({ root, agentDir: path.join(root, '.pi-state'), resumeSessionFile,
        traceContext: () => ({ parent_run_id: run.runId, session_id: run.sessionId, trace_id: run.trace_id, parent_span_id: run.span_id }) });
      session = created.session;
      if (stoppedReason) await session.abort?.();
      if (created.extensionsResult?.errors?.length) throw new Error(JSON.stringify(created.extensionsResult.errors));
      run.resources = created.resources || { skills: [] }; record({ type: 'resources_loaded', ...run.resources });
      run.sessionId = session.getSessionStats().sessionId; run.provider = session.model?.provider; run.model = session.model?.id;
      run.status = 'running'; save(path.join(directory, 'run.json'), run); record({ type: 'session_ready', limits });
      unsubscribe = session.subscribe(event => {
        if (promptStarted && event.type === 'message_start' && event.message?.role === 'assistant') answer = '';
        if (['message_end', 'tool_execution_start', 'tool_execution_end', 'agent_end', 'auto_retry_start', 'auto_retry_end', 'auto_compaction_start', 'auto_compaction_end'].includes(event.type)) record(event);
        // Stream public deltas without retaining duplicated partial SDK messages.
        if (event.type === 'message_update') {
          const visible = publicAgentEvent(event);
          if (promptStarted && visible?.type === 'text_delta') answer += visible.text;
          if (visible) { try { onEvent({ ...visible, sequence: ++publicSequence, timestamp_utc: new Date().toISOString(), run_id: run.runId }); } catch {} }
        }
        if (event.type === 'turn_start' && ++turns > limits.maxTurns) abort('model-turn-limit');
        if (event.type === 'message_end' && event.message?.role === 'assistant') {
          if (promptStarted) answer = publicAgentEvent(event)?.text || '';
          if (event.message.stopReason === 'error') failure = event.message.errorMessage || 'Model request failed';
          if (event.message.stopReason === 'aborted') stoppedReason ||= 'model-aborted';
        }
        if (event.type === 'auto_retry_end') failure = event.success ? null : event.finalError || failure || 'Model retries exhausted';
      });
      if (!stoppedReason) await session.bindExtensions({});
      if (!stoppedReason) { promptStarted = true; await session.prompt(prompt); }
    }
    run.status = stoppedReason ? 'stopped' : failure ? 'failed' : 'completed';
  } catch (error) {
    failure = String(error);
    run.status = stoppedReason ? 'stopped' : run.status === 'initializing' ? 'initialization_failed' : 'failed';
  } finally {
    clearTimeout(timer); signal?.removeEventListener('abort', onAbort); unsubscribe();
    run.stoppedReason = stoppedReason;
    run.inputDrift = run.inputs.filter(input => !fs.existsSync(path.join(root, input.path)) || hash(fs.readFileSync(path.join(root, input.path))) !== input.sha256).map(input => input.path);
    let stats = null;
    try { stats = session?.getSessionStats() || null; } catch { /* An unavailable usage receipt stays unknown. */ }
    usage = { scope: 'pi-sdk-agent-only', agentRunId: run.runId, outerCodexUsage: 'Not included in Pi statistics.', costBasis: 'Pi provider catalog estimate, not an invoice', piVersion: '1.3.0', provider: session?.model?.provider, model: session?.model?.id, thinking: session?.thinkingLevel, limits, turns, stoppedReason, stats };
    try { await session?.extensionRunner?.emit({ type: 'session_shutdown', reason: 'quit' }); }
    catch (error) { run.status = 'shutdown_failed'; run.shutdownError = String(error); record({ type: 'shutdown_error', error: String(error) }); }
    try { session?.dispose(); }
    catch (error) { run.status = 'dispose_failed'; run.disposeError = String(error); record({ type: 'dispose_error', error: String(error) }); }
    run.error = failure || run.shutdownError || run.disposeError || null;
    run.endedAt = new Date().toISOString(); run.wallSeconds = (performance.now() - started) / 1000;
    usage.status = run.status; usage.error = run.error;
    fs.writeFileSync(path.join(directory, 'answer.md'), answer + '\n');
    save(path.join(directory, 'run.json'), run); save(path.join(directory, 'usage.json'), usage);
    record({ type: 'run_end', status: run.status, stoppedReason, wallSeconds: run.wallSeconds });
    fs.closeSync(events);
  }
  return { directory, status: run.status, answer, sessionId: run.sessionId, sessionFile: session?.sessionFile, usage, run };
}
