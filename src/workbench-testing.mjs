import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { loadResults } from './results.mjs';

const hash = value => createHash('sha256').update(Buffer.isBuffer(value) || typeof value === 'string' ? value : JSON.stringify(value)).digest('hex');
const slash = value => value.replaceAll('\\', '/');
function directoryTime(id) {
  const match = id.match(/(\d{4}-\d\d-\d\d)T(\d\d)-(\d\d)-(\d\d)-(\d{3})Z/);
  return match ? `${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z` : null;
}
const states = ['passed', 'failed', 'unknown', 'not_run', 'blocked', 'review_required', 'running', 'cancelled', 'skipped', 'expected_failure', 'expected_timeout'];
const domainTitles = { functional: '功能仿真', synthesis: '综合', setup: 'Setup 时序', hold: 'Hold 时序', constraints: '约束完整性', routing: '布局布线', drc: 'DRC', cdc: 'CDC', formal: '形式验证', hardware: '板卡实测' };
const softwareGroups = [
  ['workbench', '工作台与修改边界', /workbench/],
  ['agent_loop', 'Agent 候选、验证与交付', /agent-task|verifier-loop|eda-coordinator/],
  ['agent_runtime', 'Agent 会话与资源', /agent-recording|agent-lifecycle|pi-sdk-dispatch|runtime|platform|mcp/],
  ['workflow', '任务、验收与恢复', /workflow|task-context|task-outcome/],
  ['retrieval_contract', 'RAG 与 SOP 契约', /knowledge/],
  ['trace', 'Trace、证据与导出', /trace|artifact|results|proxy|otlp/],
  ['optimization', '优化、恢复与复测', /optimizer|replay/],
  ['benchmark_contract', 'Benchmark 运行与判分', /bench|evaluation-contract/],
  ['tool_contract', '工具输入与报告解析', /fpga|contract/],
];

function inside(base, file) {
  const relative = path.relative(fs.realpathSync(base), fs.realpathSync(file));
  return relative && relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative);
}

// Read only bounded, explicit report files. Do not crawl waveform or conversation directories.
function reader(root) {
  const errors = [];
  const evidenceCache = new Map();
  const bytes = (name, limit = 8 * 1024 * 1024) => {
    const file = path.resolve(root, name);
    try {
      if (!inside(root, file) || !fs.statSync(file).isFile() || fs.statSync(file).size > limit) return null;
      return fs.readFileSync(file);
    } catch { return null; }
  };
  const json = name => {
    const data = bytes(name);
    if (!data) return null;
    try { return JSON.parse(data.toString('utf8')); }
    catch { errors.push({ path: slash(name), reason: 'invalid_json' }); return null; }
  };
  const evidence = name => {
    if (evidenceCache.has(name)) return evidenceCache.get(name);
    const data = bytes(name);
    const value = data ? { path: slash(name), sha256: hash(data) } : null;
    evidenceCache.set(name, value);
    return value;
  };
  const freshness = entries => {
    const list = Object.entries(entries || {});
    if (!list.length) return { current_sources_match: null, changed_sources: [] };
    const changed = list.filter(([name, expected]) => {
      const data = bytes(name);
      return !data || hash(data) !== expected;
    }).map(([name]) => slash(name));
    return { current_sources_match: changed.length === 0, changed_sources: changed };
  };
  return { bytes, json, evidence, freshness, errors };
}

function directories(root, pattern, limit) {
  const base = path.join(root, 'artifacts');
  try {
    if (!inside(root, base)) return [];
    return fs.readdirSync(base, { withFileTypes: true })
      .filter(item => item.isDirectory() && !item.isSymbolicLink() && pattern.test(item.name))
      .map(item => item.name).sort().reverse().slice(0, limit);
  } catch { return []; }
}

function status(value) {
  const normalized = String(value || 'unknown').toLowerCase();
  return ({ pass: 'passed', fail: 'failed', incomplete: 'unknown', timeout: 'failed', timed_out: 'failed', not_started: 'not_run' })[normalized]
    || (states.includes(normalized) ? normalized : 'unknown');
}

function summary(cases) {
  const result = { total: cases.length, ...Object.fromEntries(states.map(key => [key, 0])) };
  for (const item of cases) result[status(item.status)]++;
  result.executed = cases.filter(item => item.latest && !['not_run', 'blocked'].includes(item.status)).length;
  return result;
}

function groupCases(cases) {
  const groups = new Map();
  for (const item of cases) {
    const id = item.group || item.category || 'other';
    if (!groups.has(id)) groups.set(id, { id, title: item.group_title || id, cases: [] });
    const { group, group_title, ...publicCase } = item;
    groups.get(id).cases.push(publicCase);
  }
  return [...groups.values()].map(group => ({ ...group, summary: summary(group.cases) }));
}

function makeCase(definition, history = []) {
  history.sort((a, b) => String(b.started_at || '').localeCompare(String(a.started_at || '')));
  const latest = history[0] || null;
  return { ...definition, status: latest?.status || 'not_run', latest, history: history.slice(0, 6), history_count: history.length, evidence: latest?.evidence || [] };
}

function nodeRows(log) {
  const rows = [];
  const clean = String(log).replace(/\x1b\[[0-9;]*m/g, '');
  for (const line of clean.split(/\r?\n/)) {
    // Node's default spec reporter. Repeated failure summaries omit the timing suffix.
    const match = /^\s*([✔✖﹣-])\s+(.+?)\s+\(([\d.]+)\s*ms\)(?:\s+#\s*(SKIP|TODO).*)?$/.exec(line);
    if (match) rows.push({ title: match[2], status: match[4] || ['﹣', '-'].includes(match[1]) ? 'skipped' : match[1] === '✔' ? 'passed' : 'failed', duration_ms: Number(match[3]) });
    const tap = /^(not ok|ok) \d+ - (.+?)(?: # (SKIP|TODO).*)?$/.exec(line);
    if (tap) rows.push({ title: tap[2], status: tap[3] ? 'skipped' : tap[1] === 'ok' ? 'passed' : 'failed', duration_ms: null });
  }
  const occurrences = new Map();
  return rows.map(row => {
    const occurrence = (occurrences.get(row.title) || 0) + 1;
    occurrences.set(row.title, occurrence);
    return { ...row, identity: `${hash(row.title).slice(0, 16)}:${occurrence}` };
  });
}

function software(root, read) {
  const receipts = directories(root, /^agent-offline-\d{4}-/, 12).flatMap(id => {
    const value = read.json(`artifacts/${id}/result.json`);
    return value?.checks ? [{ id, value, prefix: `artifacts/${id}`, evidence: read.evidence(`artifacts/${id}/result.json`) }] : [];
  });
  if (!receipts.length) {
    const value = read.json('release/validation.json');
    if (value?.checks) receipts.push({ id: 'release-validation', value, prefix: 'release', evidence: read.evidence('release/validation.json') });
  }
  receipts.sort((a, b) => String(b.value.started_at).localeCompare(String(a.value.started_at)));
  const latestReceipt = receipts[0];
  if (!latestReceipt) return { cases: [], aggregates: [], receipt: null };
  const locations = new Map();
  for (const [name, expected] of Object.entries(latestReceipt.value.source_hashes || {})) {
    if (!/^tests[/\\].*\.test\.mjs$/.test(name)) continue;
    const data = read.bytes(name);
    if (!data || hash(data) !== expected) continue;
    for (const match of data.toString('utf8').matchAll(/\btest(?:\.(?:skip|todo))?\s*\(\s*(['"])([^'"\r\n]+)\1/g)) {
      if (locations.has(match[2])) locations.set(match[2], null);
      else locations.set(match[2], slash(name));
    }
  }
  const history = new Map(), aggregates = [];
  for (const receipt of receipts) {
    for (const check of receipt.value.checks) {
      const logName = receipt.prefix === 'release' ? `release/validation-${check.name}.txt` : `${receipt.prefix}/${check.name}.log`;
      const log = read.bytes(logName);
      const rows = check.name === 'node' && log ? nodeRows(log.toString('utf8')) : [];
      if (receipt === latestReceipt) aggregates.push({ name: check.name, status: check.passed === true ? 'passed' : check.passed === false ? 'failed' : 'unknown', recorded_test_count: check.test_count ?? null, individual_results: rows.length, individual_count_matches: Number.isInteger(check.test_count) ? rows.length === check.test_count : null, evidence: [receipt.evidence, read.evidence(logName)].filter(Boolean), scope: rows.length ? 'Named test outcomes parsed from the recorded reporter log.' : 'Runner aggregate only; individual test verdicts are unavailable.' });
      for (const row of rows) {
        const id = `node:${row.identity}`;
        if (!history.has(id)) history.set(id, []);
        history.get(id).push({ ...row, id: receipt.id, started_at: receipt.value.started_at, evidence: [receipt.evidence, read.evidence(logName)].filter(Boolean) });
      }
    }
  }
  const latestLog = read.bytes(latestReceipt.prefix === 'release' ? 'release/validation-node.txt' : `${latestReceipt.prefix}/node.log`);
  const newestIds = new Set((latestLog ? nodeRows(latestLog.toString('utf8')) : []).map(row => `node:${row.identity}`));
  const cases = [...history].filter(([id]) => newestIds.has(id)).map(([id, records]) => {
    const title = records[0].title, source = locations.get(title) || null;
    const [group, group_title] = source ? softwareGroups.find(([, , pattern]) => pattern.test(source)) || ['node_other', '其他 Node 契约'] : ['node_other', '未绑定源码的 Node 结果'];
    return makeCase({ id, title, category: group, group, group_title, source, tier: 'offline', unit: 'software_test' }, records);
  });
  return { cases, aggregates, receipt: { id: latestReceipt.id, started_at: latestReceipt.value.started_at, ...read.freshness(latestReceipt.value.source_hashes), evidence: [latestReceipt.evidence].filter(Boolean) } };
}

function retrieval(root, read, evaluations) {
  const catalog = read.json('knowledge/retrieval-cases.json') || { cases: [], unrelated_queries: [] };
  const receipts = evaluations.filter(item => item.value.suite === 'offline-retrieval').map(item => ({ ...item, metrics: item.value.metrics }));
  for (const id of directories(root, /^knowledge-eval-\d{4}-/, 12)) {
    const metrics = read.json(`artifacts/${id}/result.json`);
    if (metrics?.cases) receipts.push({ id, metrics, value: { started_at: directoryTime(id) }, evidence: read.evidence(`artifacts/${id}/result.json`) });
  }
  if (!receipts.length) {
    const metrics = read.json('release/knowledge-evaluation.json');
    if (metrics?.cases) receipts.push({ id: 'release-retrieval', metrics, value: {}, evidence: read.evidence('release/knowledge-evaluation.json') });
  }
  const definitions = [...catalog.cases.map(item => ({ ...item, unrelated: false })), ...catalog.unrelated_queries.map(query => ({ query, unrelated: true }))];
  return definitions.map(item => {
    const histories = receipts.flatMap(receipt => {
      const record = (item.unrelated ? receipt.metrics?.unrelated : receipt.metrics?.cases)?.find(row => row.query === item.query);
      if (!record) return [];
      const passed = item.unrelated ? record.returned === 0 : record.after?.some(id => item.relevant.includes(id));
      const currentDefinition = receipt.metrics.case_set_sha256 === hash(read.bytes('knowledge/retrieval-cases.json') || '');
      return [{ id: receipt.id, started_at: receipt.value.started_at, status: currentDefinition ? passed ? 'passed' : 'failed' : 'unknown', observed_status: passed ? 'passed' : 'failed', current_definition_match: currentDefinition,
        ...read.freshness(receipt.metrics.corpus_hashes), returned: record.after || record.returned, relevant: item.relevant || [], evidence: [receipt.evidence].filter(Boolean) }];
    });
    const category = item.unrelated ? 'abstention' : item.relevant?.[0]?.split('-')[1]?.toLowerCase() || 'retrieval';
    return makeCase({ id: `query:${hash(item.query).slice(0, 16)}`, title: item.query, category, group: category, group_title: item.unrelated ? '无关问题拒答' : `${category.toUpperCase()} 检索`, tier: 'visible_regression', unit: 'visible_query' }, histories);
  });
}

function toolsLane(root, read, catalog) {
  const summaries = directories(root, /^benchmark-\d{4}-/, 40).flatMap(id => {
    const value = read.json(`artifacts/${id}/summary.json`);
    return value?.cases ? [{ id, value, evidence: read.evidence(`artifacts/${id}/summary.json`) }] : [];
  });
  return (catalog.cases || []).map(item => {
    const history = summaries.flatMap(receipt => receipt.value.cases.filter(row => row.id === item.id).map(row => {
      const matching = row.case_definition_sha256 === hash(item);
      const casePath = `artifacts/${receipt.id}/cases/${item.id}/result.json`;
      const saved = read.json(casePath);
      const integrity = !!saved && hash(saved) === hash(row);
      return { id: receipt.id, started_at: row.started_at || receipt.value.started_at, status: matching && integrity ? status(row.acceptance?.status) : 'unknown', observed_status: status(row.acceptance?.status), raw_status: row.acceptance?.status || null,
        current_definition_match: matching, receipt_integrity: integrity, seed: row.seed, duration_ms: row.duration_ms, reason: row.acceptance?.reason || null,
        evidence: [receipt.evidence, read.evidence(casePath)].filter(Boolean), scope: 'Recorded campaign verdict; current RTL and EDA environment have not been rerun.' };
    }));
    return makeCase({ id: item.id, title: item.title, category: item.category, group: item.category, group_title: item.category, family: item.family, variant: item.variant, tier: item.tier, tool: item.tool, availability: item.availability, negative_control: Boolean(item.negative_control), unit: 'case_variant' }, history);
  });
}

function engineering(root, read) {
  const records = new Map();
  for (const id of directories(root, /^\d{4}-.*-eda_workflow_(?:run|resume)-/, 80)) {
    const prefix = `artifacts/${id}`;
    const manifest = read.json(`${prefix}/run.json`), pointer = read.json(`${prefix}/workflow.json`);
    if (!manifest || !pointer?.path || !/^checkpoints[/\\]\d+\.json$/.test(pointer.path)) continue;
    const checkpoint = read.bytes(`${prefix}/${pointer.path}`);
    if (!checkpoint || hash(checkpoint) !== pointer.sha256) continue;
    let saved;
    try { saved = JSON.parse(checkpoint.toString('utf8')); } catch { continue; }
    const spec = saved.plan?.spec;
    if (!spec?.acceptance || spec.acceptance.profile === 'evidence_review') continue;
    const outcomeBytes = read.bytes(`${prefix}/task-outcome.json`), outcome = read.json(`${prefix}/task-outcome.json`);
    const bound = !!outcomeBytes && hash(outcomeBytes) === saved.task_acceptance_hash;
    const currentInputs = read.freshness(saved.plan.input_hashes);
    for (const domain of Object.keys(domainTitles)) {
      const result = outcome?.domains?.find(item => item.domain === domain);
      const requested = Object.hasOwn(spec.acceptance.bindings || {}, domain);
      const key = `${spec.id}:${domain}`;
      if (!records.has(key)) records.set(key, { definition: { id: key, title: `${spec.id} · ${domainTitles[domain]}`, category: domain, group: domain, group_title: domainTitles[domain], project: spec.id, spec_path: saved.plan.spec_path, tier: spec.acceptance.profile, unit: 'project_domain' }, history: [] });
      let evidenceValid = false;
      if (result?.evidence?.result && result.evidence.sha256) {
        const evidence = read.bytes(result.evidence.result);
        evidenceValid = !!evidence && hash(evidence) === result.evidence.sha256;
      }
      const recorded = requested ? bound && evidenceValid ? status(result?.status) : 'unknown' : 'not_run';
      records.get(key).history.push({ id, started_at: manifest.started_at, status: recorded, observed_status: result?.status || 'not_run', requested, receipt_integrity: bound && (!requested || evidenceValid), profile: spec.acceptance.profile, observed: result?.observed ?? null,
        current_inputs: currentInputs, evidence: [read.evidence(`${prefix}/task-outcome.json`), result?.evidence?.result ? read.evidence(result.evidence.result) : null].filter(Boolean), scope: requested ? 'Recorded domain evidence. Open the run for full current source, input and recovery checks.' : 'No acceptance binding or execution for this domain.' });
    }
  }
  return [...records.values()].map(({ definition, history }) => makeCase(definition, history));
}

function onlineAgent(read, evaluations) {
  const records = new Map(), unbound = [];
  for (const {id, value, evidence} of evaluations.filter(item => item.value.suite === 'online-agent')) {
    const session = typeof value.session === 'string' && value.session ? slash(value.session) : null;
    const workflow = typeof value.workflow === 'string' && value.workflow ? slash(value.workflow) : null;
    const observation = {id, started_at:value.started_at, status:status(value.status), session, workflow,
      reason:value.reason || value.error || null, evidence:[evidence].filter(Boolean), ...read.freshness(value.source_hashes)};
    if (!session || !workflow) {unbound.push(observation);continue;}
    const key = hash(JSON.stringify([session, workflow]));
    if (!records.has(key)) records.set(key, {definition:{id:`online-agent-${key}`,title:`Pi 会话 · ${path.posix.basename(session)}`,
      category:'end_to_end',group:'end_to_end',group_title:'端到端任务',tier:'online',unit:'session_task',session,workflow},history:[]});
    records.get(key).history.push(observation);
  }
  return {cases:[...records.values()].map(({definition,history})=>makeCase(definition,history)),unbound_history:unbound};
}

/** A read-only projection: browsing this endpoint never executes EDA, retrieval or a model. */
export function getTestingOverview(root) {
  root = fs.realpathSync(root);
  const read = reader(root), catalog = read.json('benchmarks/catalog.json') || { cases: [], categories: [], tiers: [] };
  const evaluations = directories(root, /^evaluation-\d{4}-/, 40).flatMap(id => {
    const value = read.json(`artifacts/${id}/result.json`);
    return value?.suite ? [{ id, value, evidence: read.evidence(`artifacts/${id}/result.json`) }] : [];
  });
  const code = software(root, read);
  const online = onlineAgent(read, evaluations);
  const definitions = [
    { id: 'software', title: '软件机制', unit: 'software_test', cases: code.cases, aggregates: code.aggregates, receipt: code.receipt, scope: 'Named Node test results. Python and other runner totals remain separate aggregates.' },
    { id: 'retrieval', title: 'RAG 与 SOP', unit: 'visible_query', cases: retrieval(root, read, evaluations), scope: 'Visible retrieval and unrelated-query regression; no blind answer correctness claim.' },
    { id: 'tool_execution', title: '工具与案例', unit: 'case_variant', cases: toolsLane(root, read, catalog), scope: 'Catalog variants joined to recorded campaign receipts. Missing runs remain not_run. Expected negative controls remain separate from design passes.' },
    { id: 'engineering', title: '工程验收', unit: 'project_domain', cases: engineering(root, read), scope: 'Latest recorded verdict per project and domain. Formal and board-level acceptance require their own evidence.' },
    { id: 'online_agent', title: 'Agent 在线任务', unit: 'session_task', ...online, scope: 'One case per recorded session/workflow pair; repeated assessments remain history. Unbound receipts are retained outside the task denominator. Fake SDK and browser fixtures cannot count as live successes.' },
  ];
  let historical = [];
  try { historical = loadResults(root).records.map(({ evidence, ...item }) => ({ ...item, evidence, scope_kind: 'historical_scorecard' })); } catch { /* A new workspace may not have a history catalog. */ }
  return { schema_version: 1, generated_at: new Date().toISOString(), aggregate_score: null,
    lanes: definitions.map(({ cases, ...lane }) => ({ ...lane, summary: summary(cases), groups: groupCases(cases) })),
    catalog: { version: catalog.catalog_version || null, total: catalog.cases.length, families: new Set(catalog.cases.map(item => item.family)).size, categories: catalog.categories, tiers: catalog.tiers },
    historical, scan: { limits: { software_receipts: 12, evaluation_receipts: 40, benchmark_receipts: 40, workflow_receipts: 80 }, errors: read.errors },
    limitations: ['各层单位不同，不合并成一个通过率。', '历史日志只有汇总时保留汇总，不补造逐条测试结果。', '目录数量表示已定义案例，not_run 表示没有关联的执行证据。', '记录结果及其当前输入匹配状态分别显示；浏览表盘不会复跑 EDA。'] };
}
