import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {createHash, randomUUID} from 'node:crypto';
import {readConfig, pidAlive} from './runtime.mjs';
import {loadResults} from './results.mjs';
import {querySop} from './knowledge.mjs';
import {inspectTrace} from '../scripts/trace-inspect.mjs';
import {inspectWorkflow} from './workflow.mjs';
import {evaluationSuites, evaluationPlan, runEvaluation, evaluationFreshness} from './evaluations.mjs';
import {createWorkbenchState, activeJobStates, contained, readJson, now, safeId} from './workbench-state.mjs';
import {listRunArtifacts, readRunArtifact} from './workbench-artifacts.mjs';
import {listProjects, getProject, readProjectSource} from './workbench-projects.mjs';
import {getTestingOverview} from './workbench-testing.mjs';
import {listChanges, getChange, planChange, previewChange, applyChange, checkChange} from './workbench-changes.mjs';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Each preview has its own trace directory; the executable contract excludes only that receipt location.
const planDigest = ({evidence, ...contract}) => digest(contract);
const conflict = message => Object.assign(new Error(message), {statusCode: 409});
const specimens = ['offline-review', 'counter-simulation', 'axi-fabric-ooc'];
const messageText = data => {
  if (typeof data.message !== 'string' || !data.message.trim() || data.message.length > 8192) throw new Error('Enter a task of 1–8192 characters');
  return data.message.trim();
};
function specPath(root, spec) {
  const name = specimens.includes(spec) ? `examples/workflows/${spec}.json` : spec;
  if (typeof name !== 'string' || !/^(examples\/workflows|projects)\/[a-zA-Z0-9_./-]+\.json$/.test(name) || name.split('/').includes('..')) throw new Error('Choose a workflow JSON under examples/workflows or projects');
  const file = fs.realpathSync(path.join(root, name)), base = fs.realpathSync(root), rel = path.relative(base, file).replaceAll('\\', '/');
  if (!/^(examples\/workflows|projects)\//.test(rel) || rel.includes('/.')) throw new Error('Workflow outside approved project directories');
  return rel;
}
export function createWorkbench(root, registry, options = {}) {
  const artifacts = path.join(root, 'artifacts'), state = createWorkbenchState(root), ownedJobs = new Map(), streams = new Set();
  fs.mkdirSync(artifacts, {recursive: true});
  const instanceId = randomUUID();
  function runLabel(dir, manifest) {
    const spec = manifest.arguments?.spec;
    const titles = {'offline-review': '离线证据复核', 'counter-simulation': 'Counter RTL 仿真', 'axi-fabric-ooc': 'AXI 互连工程验收'};
    let goal = null;
    try {
      const pointer = readJson(path.join(dir, 'workflow.json'));
      if (/^checkpoints\/[0-9]+\.json$/.test(pointer.path)) {
        const bytes = fs.readFileSync(path.join(dir, pointer.path));
        if (createHash('sha256').update(bytes).digest('hex') === pointer.sha256) goal = JSON.parse(bytes).plan?.spec?.goal;
      }
    } catch { /* Older traces may have no committed workflow checkpoint. */ }
    return {title: titles[path.basename(spec || '', '.json')] || goal || null, goal};
  }
  const runList = () => {
    const rows = fs.readdirSync(artifacts, {withFileTypes: true}).filter(e => e.isDirectory() && !e.isSymbolicLink() && fs.existsSync(path.join(artifacts, e.name, 'run.json')))
    .flatMap(e => { try { const dir = path.join(artifacts, e.name), m = readJson(path.join(dir, 'run.json')); return [{id: e.name, tool: m.tool || m.mode, status: m.status, started_at: m.started_at || m.startedAt, workflow: fs.existsSync(path.join(dir, 'workflow.json')), pi_session: m.mode === 'pi-sdk-agent', ...runLabel(dir, m)}]; } catch { return []; } })
      .sort((a, b) => (b.started_at || '').localeCompare(a.started_at || ''));
    const retained = new Set(rows.filter(row => row.workflow || row.pi_session).slice(0, 80).map(row => row.id));
    return rows.filter((row, index) => index < 160 || retained.has(row.id));
  };
  function jobView(id) {
    const job = state.get('jobs', id);
    if (activeJobStates.has(job.status) && pidAlive(job.owner_pid) === false) {
      job.status = 'interrupted'; job.finished_at = now(); job.error = 'Owning process ended before recording a terminal result. Inspect evidence before any explicit retry.';
      state.save('jobs', job);
      if (job.task_id) { const task = state.get('tasks', job.task_id); task.status = 'interrupted'; task.updated_at = now(); state.save('tasks', task); }
    }
    return {...job, controllable: ownedJobs.has(id) && activeJobStates.has(job.status), owner_alive: pidAlive(job.owner_pid)};
  }
  const jobsList = () => state.list('jobs').map(j => jobView(j.id)).sort((a, b) => b.started_at.localeCompare(a.started_at)).slice(0, 160);
  function reconcileSession(id) { for (const job of state.list('jobs')) if (job.session_id === id) jobView(job.id); }
  const sessionList = () => state.list('sessions').map(s => ({id: s.id, title: s.title, updated_at: s.updated_at, created_at: s.created_at, mode: s.mode, archived: Boolean(s.archived), archived_at: s.archived_at || null, task_count: s.task_ids?.length || 0})).sort((a, b) => b.updated_at.localeCompare(a.updated_at));
  function availableSession(id) { const s = state.get('sessions', id); if (s.archived) throw conflict('Restore this archived session before continuing'); return s; }
  async function body(req) {
    let value = ''; for await (const chunk of req) { value += chunk; if (Buffer.byteLength(value) > 32768) throw new Error('Request exceeds 32 KiB'); }
    return JSON.parse(value || '{}');
  }
  state.subscribe(event => {
    for (const stream of streams) if (stream.sessionId === event.session_id && event.sequence > stream.cursor && !stream.res.destroyed) {
      try {
        if (stream.res.writableLength > 524288) { stream.res.end(); streams.delete(stream); continue; }
        stream.res.write(`id: ${event.sequence}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`); stream.cursor = event.sequence;
      } catch { stream.res.destroy(); streams.delete(stream); }
    }
  });
  function publish(sessionId, type, fields = {}) { return state.emit(sessionId, type, fields); }
  function startJob(kind, execute, {sessionId, task, release} = {}) {
    const id = randomUUID(), controller = new AbortController();
    const job = {schema_version: 1, id, kind, status: 'queued', session_id: sessionId || null, task_id: task?.id || null,
      started_at: now(), updated_at: now(), owner_pid: process.pid, owner_instance: instanceId};
    state.save('jobs', job);
    if (task) { task.job_id = id; task.status = 'queued'; task.updated_at = now(); state.save('tasks', task); }
    const owned = {controller, promise: null}; ownedJobs.set(id, owned);
    publish(sessionId, 'job_status', {job_id: id, task_id: task?.id, status: 'queued'});
    const update = value => publish(sessionId, 'tool_update', {job_id: id, task_id: task?.id, update: value});
    owned.promise = Promise.resolve().then(async () => {
      controller.signal.throwIfAborted();
      job.status = 'running'; job.updated_at = now(); state.save('jobs', job);
      if (task) { task.status = 'running'; task.updated_at = now(); state.save('tasks', task); }
      publish(sessionId, 'job_status', {job_id: id, task_id: task?.id, status: 'running'});
      const result = await execute(controller.signal, update); job.result = result;
      job.status = result?.status && !activeJobStates.has(result.status) ? result.status : 'completed';
      if (controller.signal.aborted && job.status !== 'cancelled') job.cancel_acknowledged = false;
      if (job.status === 'cancelled') job.cancel_acknowledged = true;
    }).catch(error => {
      job.status = controller.signal.aborted && (error.name === 'AbortError' || error === controller.signal.reason) ? 'cancelled' : 'failed';
      job.error = error.message; job.cancel_acknowledged = job.status === 'cancelled';
    }).finally(() => {
      const recorded = state.get('jobs', id);
      if (recorded.cancel_requested_at) job.cancel_requested_at = recorded.cancel_requested_at;
      job.finished_at = now(); job.updated_at = job.finished_at; state.save('jobs', job);
      if (task) { task.status = job.status; task.result = job.result || null; task.error = job.error || null; task.updated_at = now(); task.run_id = job.result?.directory ? path.basename(job.result.directory) : null; state.save('tasks', task); }
      publish(sessionId, 'job_status', {job_id: id, task_id: task?.id, status: job.status, result: job.result, error: job.error});
      try { release?.(); } finally { ownedJobs.delete(id); }
    });
    return {...job, controllable: true};
  }
  async function sendMessage(data) {
    const text = messageText(data), s = data.id ? availableSession(data.id) : state.createSession(text.slice(0, 60)), release = state.acquire(s.id);
    try {
      if (s.title === '新会话' && s.messages.length === 0) { s.title = text.slice(0, 60); state.save('sessions', s); }
      state.appendMessage(s.id, {role: 'user', text});
      try {
        const result = await registry.get('eda_task_context').execute(`ui-${randomUUID()}`, {query: text, ...(data.phase ? {phase: data.phase} : {}), ...(data.directory ? {directory: data.directory} : {})}, undefined, undefined, {edaTraceContext: {session_id: s.id}});
        state.appendMessage(s.id, {role: 'context', context: result.details});
      } catch (error) { state.appendMessage(s.id, {role: 'error', text: error.message}); }
      return state.session(s.id);
    } finally { release(); }
  }
  function editSession(data) {
    if (data.action === 'create') {
      const title = data.title == null ? '新会话' : String(data.title).trim();
      if (!title || title.length > 120) throw new Error('Title must contain 1–120 characters');
      return state.session(state.createSession(title).id);
    }
    const release = state.acquire(data.id);
    try {
      const s = state.get('sessions', data.id);
      if (data.action === 'rename') {
        if (typeof data.title !== 'string' || !data.title.trim() || data.title.length > 120) throw new Error('Title must contain 1–120 characters');
        s.title = data.title.trim();
      } else if (data.action === 'archive' || data.action === 'restore') { s.archived = data.action === 'archive'; s.archived_at = s.archived ? now() : null; }
      else throw new Error('Unknown session action');
      s.updated_at = now(); state.save('sessions', s); publish(s.id, 'session_updated', {title: s.title, archived: s.archived}); return state.session(s.id);
    } finally { release(); }
  }
  function changes(data) {
    if (!['plan', 'preview', 'apply', 'check'].includes(data.action)) throw new Error('Unknown modification action');
    const previous = data.action === 'plan' ? null : getChange(root, data.id);
    const sessionId = previous?.session_id || data.session_id;
    if (previous?.session_id && data.session_id && data.session_id !== previous.session_id) throw conflict('Modification belongs to another session');
    if (sessionId) availableSession(sessionId);
    const release = sessionId ? state.acquire(sessionId) : null;
    try {
      const result = data.action === 'plan' ? planChange(root, data) : data.action === 'preview' ? previewChange(root, data) : data.action === 'apply' ? applyChange(root, data) : checkChange(root, data.id);
      if (sessionId) {
        if (data.action === 'plan') state.appendMessage(sessionId, {role: 'change', change_id: result.id, project_id: result.project_id, text: result.goal});
        publish(sessionId, 'change_status', {change_id: result.id, project_id: result.project_id, status: result.status});
      }
      return result;
    } finally { release?.(); }
  }
  async function workflow(data) {
    if (!['plan', 'run'].includes(data.action)) throw new Error('Choose a known task action');
    if (data.plan_id && !data.session_id) throw conflict('A saved plan requires its owning session');
    const args = {spec: specPath(root, data.spec)}, sessionId = data.session_id;
    if (sessionId) availableSession(sessionId);
    const release = sessionId ? state.acquire(sessionId) : null; let handedOff = false;
    try {
      const plan = (await registry.get('eda_workflow_plan').execute(`ui-${randomUUID()}`, args)).details;
      if (data.action === 'plan') {
        if (!sessionId) return {statusCode: 200, result: plan};
        const id = randomUUID(), task = {schema_version: 1, id, plan_id: id, session_id: sessionId, spec: data.spec, title: plan.spec.goal,
          status: 'planned', plan, plan_hash: planDigest(plan), created_at: now(), updated_at: now(), job_id: null, result: null};
        state.save('tasks', task);
        const s = state.get('sessions', sessionId); s.task_ids ||= []; s.task_ids.push(id); s.updated_at = now(); state.save('sessions', s);
        state.appendMessage(sessionId, {role: 'task', task_id: id}); publish(sessionId, 'task_planned', {task_id: id, status: task.status});
        return {statusCode: 200, result: {...plan, task_id: id, plan_id: id, task}};
      }
      let task;
      if (sessionId) {
        if (!data.plan_id) throw conflict('Preview a plan in this session before execution');
        task = state.get('tasks', data.plan_id);
        if (task.session_id !== sessionId || task.spec !== data.spec) throw conflict('Plan belongs to a different session or task');
        if (task.status !== 'planned') throw conflict('This plan has already been started; create a new plan for another run');
        if (planDigest(plan) !== task.plan_hash) throw conflict('Plan inputs, guidance or implementation changed; preview a new plan');
      }
      const job = startJob(`workflow:${data.spec}`, (signal, update) => registry.get('eda_workflow_run').execute(`ui-${randomUUID()}`, args, signal, update, {edaTraceContext: {session_id: sessionId, task_id: task?.id}}).then(r => r.details), {sessionId, task, release});
      handedOff = true; return {statusCode: 202, result: job};
    } finally { if (!handedOff) release?.(); }
  }
  async function agent(data) {
    if (!readConfig(root).model_api_enabled) throw Object.assign(new Error('模型 API 已停用。当前可使用本地检索与工具流程。'), {statusCode: 403});
    const prompt = messageText(data), s = availableSession(data.session_id), release = state.acquire(s.id);
    try {
      const adapter = options.agentAdapter || (await import('./agent-session.mjs')).runAgentSession;
      state.appendMessage(s.id, {role: 'user', text: prompt});
      return startJob('agent', async signal => {
        let pending = null, timer = null, streamError = null;
        const flush = () => {
          clearTimeout(timer); timer = null;
          if (pending) { const event = pending; pending = null; publish(s.id, 'agent_event', {event}); }
        };
        const onEvent = event => {
          if (streamError) throw streamError;
          if (event.type !== 'text_delta') { flush(); publish(s.id, 'agent_event', {event}); return; }
          pending = pending ? {...event, first_sequence: pending.first_sequence, text: pending.text + event.text} : {...event, first_sequence: event.sequence};
          if (pending.text.length >= 512) flush();
          else if (!timer) { timer = setTimeout(() => { try { flush(); } catch (error) { streamError = error; } }, 100); timer.unref(); }
        };
        let result;
        try {
          result = await adapter({root, prompt, limits: {maxTurns: 24, timeoutSeconds: 600}, signal,
            resumeSessionFile: state.get('sessions', s.id).native_session_file, onEvent});
        } finally { flush(); }
        if (streamError) throw streamError;
        const saved = state.get('sessions', s.id); if (result.sessionFile) saved.native_session_file = result.sessionFile;
        saved.mode = 'native_agent'; state.save('sessions', saved);
        if (result.answer) state.appendMessage(s.id, {role: 'assistant', text: result.answer});
        const {sessionFile, ...publicResult} = result; return publicResult;
      }, {sessionId: s.id, release});
    } catch (error) { release(); throw error; }
  }
  async function recover(data) {
    if (!['check', 'resume'].includes(data.action)) throw new Error('Choose recovery check or resume');
    const directory = contained(artifacts, data.run_id);
    if (!fs.existsSync(path.join(directory, 'workflow.json'))) throw new Error('Selected run is not a workflow');
    if (data.session_id) availableSession(data.session_id);
    const args = {directory};
    const check = async () => (await registry.get('eda_workflow_resume_check').execute(`ui-${randomUUID()}`, args)).details;
    if (data.action === 'check') return {statusCode: 200, result: {...await check(), source_run_id: data.run_id}};
    if (!data.session_id) throw conflict('Select a session before resuming a workflow');
    const release = state.acquire(data.session_id); let handedOff = false;
    try {
      const checked = await check();
      if (checked.ready !== true) return {statusCode: 409, result: {error: 'Recovery prerequisites are not met', recovery: checked}};
      const tasks = state.list('tasks'), source = tasks.find(t => t.run_id === data.run_id);
      if (source && source.session_id !== data.session_id) throw conflict('Resume the task from its owning session');
      if (tasks.some(t => t.source_run_id === data.run_id && t.job_id)) throw conflict('This run already has a continuation; inspect its latest task before continuing');
      const plan = source?.plan || inspectWorkflow(root, directory).state.plan;
      const id = randomUUID(), task = {schema_version: 1, id, plan_id: id, session_id: data.session_id,
        spec: source?.spec || plan.spec_path, title: plan.spec.goal, status: 'planned', plan,
        source_run_id: data.run_id, source_task_id: source?.id || null, recovery_check: checked,
        created_at: now(), updated_at: now(), job_id: null, result: null};
      state.save('tasks', task);
      const session = state.get('sessions', data.session_id); session.task_ids ||= []; session.task_ids.push(id); state.save('sessions', session);
      state.appendMessage(data.session_id, {role: 'task', task_id: id});
      const job = startJob(`recovery:${data.run_id}`, (signal, update) => registry.get('eda_workflow_resume').execute(`ui-${randomUUID()}`, args, signal, update,
        {edaTraceContext: {session_id: data.session_id, task_id: id}}).then(r => r.details), {sessionId: data.session_id, task, release});
      handedOff = true; return {statusCode: 202, result: {...job, source_run_id: data.run_id}};
    } finally { if (!handedOff) release(); }
  }
  const headers = {'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'"};
  const server = http.createServer(async (req, res) => {
    const origin = `http://127.0.0.1:${server.address().port}`;
    const send = (status, value, type = 'application/json') => { res.writeHead(status, {...headers, 'Content-Type': `${type}; charset=utf-8`}); res.end(type === 'application/json' ? JSON.stringify(value) : value); };
    try {
      if (req.headers.host !== `127.0.0.1:${server.address().port}` || req.headers.origin && req.headers.origin !== origin) return send(403, {error: 'Local same-origin access required'});
      const url = new URL(req.url, origin), route = url.pathname;
      if (req.method === 'GET' && !route.startsWith('/api/')) {
        const name = route === '/' ? 'index.html' : decodeURIComponent(route.slice(1));
        if (!/^[a-zA-Z0-9_./-]+\.(html|js|css|svg)$/.test(name) || name.split('/').includes('..')) return send(404, {error: 'Unknown asset'});
        const base = fs.realpathSync(path.join(root, 'web/workbench')), file = path.resolve(base, name);
        if (!fs.existsSync(file)) return send(404, {error: 'Unknown asset'});
        const rel = path.relative(base, fs.realpathSync(file)); if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return send(403, {error: 'Asset outside workspace'});
        return send(200, fs.readFileSync(file, 'utf8'), {'.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml'}[path.extname(file)]);
      }
      if (req.method === 'GET' && route === '/api/overview') return send(200, {config: {model_api_enabled: readConfig(root).model_api_enabled}, runs: runList(), sessions: sessionList(), jobs: jobsList(), sops: querySop(root).sops, specimens, suites: evaluationSuites,
        history: loadResults(root).records.map(({evidence, ...r}) => ({...r, evidence_count: evidence.length}))});
      if (req.method === 'GET' && route === '/api/projects') return send(200, listProjects(root));
      if (req.method === 'GET' && route === '/api/project') return send(200, getProject(root, url.searchParams.get('id')));
      if (req.method === 'GET' && route === '/api/project-source') return send(200, readProjectSource(root, url.searchParams.get('id'), url.searchParams.get('path'), {
        ...(url.searchParams.has('start_line') ? {start_line: Number(url.searchParams.get('start_line'))} : {}),
        ...(url.searchParams.has('line_count') ? {line_count: Number(url.searchParams.get('line_count'))} : {}),
      }));
      if (req.method === 'GET' && route === '/api/testing') return send(200, getTestingOverview(root));
      if (req.method === 'GET' && route === '/api/changes') return send(200, listChanges(root, url.searchParams.get('project_id')));
      if (req.method === 'GET' && route === '/api/change') return send(200, getChange(root, url.searchParams.get('id')));
      if (req.method === 'GET' && route === '/api/run') {
        const dir = contained(artifacts, url.searchParams.get('id')), m = readJson(path.join(dir, 'run.json')); let workflow = null;
        try { if (fs.existsSync(path.join(dir, 'workflow.json'))) {
          const {state: saved, results, ...r} = inspectWorkflow(root, dir);
          const outcomeFile = path.join(dir, 'task-outcome.json');
          const recordedIntegrity = Boolean(saved.task_acceptance_hash && fs.existsSync(outcomeFile) && createHash('sha256').update(fs.readFileSync(outcomeFile)).digest('hex') === saved.task_acceptance_hash);
          workflow = {...r, goal: saved.plan.spec.goal, spec: saved.plan.spec, input_hashes: saved.plan.input_hashes,
            steps: saved.plan.spec.steps.map(s => ({id: s.id, tool: s.tool})), guidance: saved.plan.guidance,
            recorded_acceptance: recordedIntegrity ? readJson(outcomeFile) : null, recorded_acceptance_integrity: recordedIntegrity,
            recorded_scope: 'Historical outcome bound to its saved checkpoint. Current source and evidence checks are reported separately in task_acceptance and issues.'};
        } }
        catch (error) { workflow = {valid: false, error: error.message}; }
        const eventsFile = path.join(dir, 'events.jsonl'), events = fs.existsSync(eventsFile) ? fs.readFileSync(eventsFile, 'utf8').trim().split(/\r?\n/).slice(-100).flatMap(line => {
          try { const e = JSON.parse(line); return [{seq: e.seq || e.sequence, type: e.type, time: e.timestamp_utc, tool: e.tool || e.tool_name || e.toolName, step: e.step_id, status: e.status}]; } catch { return []; }
        }) : [];
        const prompt = m.mode === 'pi-sdk-agent' && fs.existsSync(path.join(dir, 'prompt.txt')) ? fs.readFileSync(path.join(dir, 'prompt.txt'), 'utf8').slice(0, 8000) : null;
        const ownerSession = state.list('tasks').find(task => task.run_id === path.basename(dir))?.session_id || null;
        const preview = listRunArtifacts(root, path.basename(dir));
        return send(200, {id: path.basename(dir), owner_session_id: ownerSession, ...runLabel(dir, m), artifacts: preview.files, artifact_preview: preview,
          manifest: {tool: m.tool || m.mode, status: m.status, started_at: m.started_at || m.startedAt, finished_at: m.finished_at || m.endedAt}, inspection: inspectTrace(dir), workflow, events, prompt});
      }
      if (req.method === 'GET' && route === '/api/artifacts') return send(200, listRunArtifacts(root, url.searchParams.get('run_id')));
      if (req.method === 'GET' && route === '/api/artifact') return send(200, readRunArtifact(root, url.searchParams.get('run_id'), url.searchParams.get('file'), {
        ...(url.searchParams.has('offset') ? {offset: Number(url.searchParams.get('offset'))} : {}),
        ...(url.searchParams.has('limit') ? {limit: Number(url.searchParams.get('limit'))} : {}),
      }));
      if (req.method === 'GET' && route === '/api/session') { const id = url.searchParams.get('id'); reconcileSession(id); return send(200, state.session(id)); }
      if (req.method === 'GET' && route === '/api/task') {
        const task = state.get('tasks', url.searchParams.get('id'));
        if (url.searchParams.has('session_id') && task.session_id !== url.searchParams.get('session_id')) throw conflict('Task belongs to a different session');
        if (task.job_id) jobView(task.job_id); return send(200, state.get('tasks', task.id));
      }
      if (req.method === 'GET' && route === '/api/jobs') return send(200, {jobs: jobsList()});
      if (req.method === 'GET' && route === '/api/job') {
        const id = url.searchParams.get('id'); if (!safeId(id) || !fs.existsSync(path.join(state.bases.jobs, id))) return send(404, {error: 'Unknown job'}); return send(200, jobView(id));
      }
      if (req.method === 'GET' && route === '/api/events') {
        const sessionId = url.searchParams.get('session_id'), after = Number(req.headers['last-event-id'] ?? url.searchParams.get('after') ?? 0);
        if (!Number.isSafeInteger(after) || after < 0) throw new Error('Invalid event cursor'); const snapshot = state.events(sessionId, after);
        if (url.searchParams.get('format') !== 'sse') return send(200, snapshot);
        res.writeHead(200, {...headers, 'Content-Type': 'text/event-stream', Connection: 'keep-alive'});
        res.write(': connected\n\n');
        const stream = {sessionId, cursor: after, res}; let page = snapshot;
        do { for (const event of page.events) { res.write(`id: ${event.sequence}\nevent: update\ndata: ${JSON.stringify(event)}\n\n`); stream.cursor = event.sequence; } page = page.has_more ? state.events(sessionId, stream.cursor) : null; } while (page);
        streams.add(stream); const timer = setInterval(() => res.write(': keepalive\n\n'), 15000); timer.unref();
        req.on('close', () => { clearInterval(timer); streams.delete(stream); }); return;
      }
      if (req.method === 'GET' && route === '/api/evaluations') {
        const receipts = fs.readdirSync(artifacts, {withFileTypes: true}).filter(e => e.isDirectory() && !e.isSymbolicLink() && e.name.startsWith('evaluation-')).flatMap(e => {
          try { const receipt = readJson(path.join(artifacts, e.name, 'result.json')); return [{...receipt, freshness: evaluationFreshness(root, receipt), id: e.name}]; } catch { return []; }
        }).sort((a, b) => b.started_at.localeCompare(a.started_at)); return send(200, {suites: evaluationSuites.map(s => evaluationPlan(root, s.id)), receipts});
      }
      if (req.method !== 'POST') return send(404, {error: 'Unknown route'});
      if (req.headers.origin !== origin) return send(403, {error: 'POST requires same-origin browser request'}); const data = await body(req);
      if (route === '/api/context') return send(200, (await registry.get('eda_task_context').execute(`ui-${randomUUID()}`, data)).details);
      if (route === '/api/sop') return send(200, querySop(root, {id: data.id}));
      if (route === '/api/session') return send(200, data.action ? editSession(data) : await sendMessage(data));
      if (route === '/api/changes') return send(200, changes(data));
      if (route === '/api/workflow') { const r = await workflow(data); return send(r.statusCode, r.result); }
      if (route === '/api/agent') return send(202, await agent(data));
      if (route === '/api/recovery') { const r = await recover(data); return send(r.statusCode, r.result); }
      if (route === '/api/evaluate') {
        evaluationPlan(root, data.suite); const sessionId = data.session_id; if (sessionId) availableSession(sessionId);
        const release = sessionId ? state.acquire(sessionId) : null;
        return send(202, startJob(`evaluation:${data.suite}`, signal => runEvaluation(root, data.suite, registry, {signal, session_directory: data.session_directory, workflow_directory: data.workflow_directory}), {sessionId, release}));
      }
      if (route === '/api/cancel') {
        if (!safeId(data.id) || !fs.existsSync(path.join(state.bases.jobs, data.id))) throw new Error('Unknown owned job');
        const job = jobView(data.id), owned = ownedJobs.get(data.id);
        if (data.session_id && job.session_id !== data.session_id) throw conflict('Job belongs to a different session');
        if (!activeJobStates.has(job.status)) return send(200, {cancel_requested: false, status: job.status, job_id: job.id});
        if (!owned) throw conflict('This job belongs to another worker; inspect its owner before recovery');
        job.status = 'cancel_requested'; job.cancel_requested_at = now(); state.save('jobs', job);
        if (job.task_id) { const task = state.get('tasks', job.task_id); task.status = 'cancel_requested'; state.save('tasks', task); }
        publish(job.session_id, 'job_status', {job_id: job.id, task_id: job.task_id, status: 'cancel_requested'});
        owned.controller.abort(); return send(200, {cancel_requested: true, status: 'cancel_requested', job_id: job.id});
      }
      return send(404, {error: 'Unknown route'});
    } catch (error) { if (!res.headersSent) send(error.statusCode || 400, {error: error.message}); else res.end(); }
  });
  return {server, close: async () => {
    for (const owned of ownedJobs.values()) owned.controller.abort(); for (const stream of streams) stream.res.end();
    await new Promise(resolve => server.close(resolve)); await Promise.allSettled([...ownedJobs.values()].map(j => j.promise));
  }};
}
