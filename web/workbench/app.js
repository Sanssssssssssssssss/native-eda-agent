const $ = (selector) => document.querySelector(selector);
const esc = (value) =>
  String(value ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const paths = {
  chip: '<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9 1v5m6-5v5M9 18v5m6-5v5M1 9h5m-5 6h5m12-6h5m-5 6h5"/><path d="M10 10h4v4h-4z"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  chat: '<path d="M21 11.5a8.5 8.5 0 0 1-8.5 8.5H4l-3 2v-10A8.5 8.5 0 0 1 9.5 3h3a8.5 8.5 0 0 1 8.5 8.5Z"/><path d="M7 9h9M7 13h6"/>',
  runs: '<rect x="4" y="3" width="16" height="18" rx="2"/><path d="m8 8 1 1 2-2m-3 7 1 1 2-2m3-5h3m-3 6h3"/>',
  book: '<path d="M12 5c-3-2-6-2-10-1v15c4-1 7-1 10 1m0-15c3-2 6-2 10-1v15c-4-1-7-1-10 1V5Z"/>',
  chart: '<path d="M4 3v18h17M8 16v-5m5 5V7m5 9V4"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  settings: '<path d="M4 6h16M4 18h16M9 3v6m6 6v6"/>',
  arrow: '<path d="m5 12 7-7 7 7M12 5v14"/>',
  right: '<path d="m9 5 7 7-7 7"/>',
  back: '<path d="m14 5-7 7 7 7"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  shield:
    '<path d="m12 3 8 3v5c0 5-4 8-8 10-4-2-8-5-8-10V6l8-3Z"/><path d="m8 12 3 3 5-6"/>',
  flow: '<rect x="3" y="3" width="6" height="5" rx="1"/><rect x="15" y="16" width="6" height="5" rx="1"/><path d="M6 8v9h9m-9-5h12V8"/><rect x="15" y="3" width="6" height="5" rx="1"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  wave: '<path d="M2 12h4l2-7 4 14 3-10 2 3h5"/>',
  check: '<path d="m5 12 4 4L19 6"/>',
  play: '<path d="m8 5 11 7-11 7V5Z"/>',
  stop: '<rect x="5" y="5" width="14" height="14" rx="2"/>',
  refresh:
    '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5 8a8 8 0 0 1 13-4l2 3M4 17l2 3a8 8 0 0 0 13-4"/>',
  file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6Z"/><path d="M14 2v6h6M8 13h8m-8 4h5"/>',
  folder:
    '<path d="M3 7V5a2 2 0 0 1 2-2h5l2 3h7a2 2 0 0 1 2 2v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z"/>',
  warning: '<path d="m12 3 10 18H2L12 3Z"/><path d="M12 9v5m0 3h.01"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  link: '<path d="m10 13 4-4m-6 7-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2-1 1-1a4 4 0 0 1 6 6l-4 4a4 4 0 0 1-6 0"/>',
  archive:
    '<rect x="3" y="3" width="18" height="5" rx="1"/><path d="M5 8v13h14V8M9 12h6"/>',
  tool: '<path d="M14 6a5 5 0 0 0-6 6l-6 6 4 4 6-6a5 5 0 0 0 6-6l-3 3-4-4 3-3Z"/>',
};
const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.file}</svg>`;
const statusNames = {
  prepared: "范围已固定",
  invalid: "证据失效",
  budget_exhausted: "预算用尽",
  passed: "通过",
  pass: "通过",
  completed: "执行完成",
  failed: "失败",
  error: "失败",
  unknown: "待核验",
  review_required: "需审查",
  not_requested: "未要求",
  not_evaluated: "未评估",
  running: "运行中",
  planned: "待执行",
  awaiting_confirmation: "待执行",
  cancel_requested: "正在停止",
  cancelled: "已停止",
  timed_out: "超时",
  blocked: "缺少前提",
  interrupted: "已中断",
  queued: "排队中",
  not_run: "未执行",
  not_required: "未要求",
  historical: "历史证据",
  current_evidence: "当前证据",
  sources_present: "源码已收录",
  metadata_only: "仅项目说明",
  previewed: "差异已预览",
  candidate_created: "候选已生成",
  expected_failure: "预期失败",
  expected_timeout: "预期超时",
};
const badge = (status) =>
  `<span class="badge ${esc(status)}"><span class="dot"></span>${esc(statusNames[status] || status || "待核验")}</span>`;
const domainNames = {
  functional: "功能仿真",
  synthesis: "综合",
  setup: "建立时间",
  hold: "保持时间",
  constraints: "时钟与约束",
  routing: "布局布线",
  drc: "设计规则检查",
  cdc: "跨时钟域",
  artifact_integrity: "证据完整性",
};
const profileNames = {
  evidence_review: "证据复核",
  rtl_simulation: "RTL 功能验收",
  fpga_ooc: "FPGA 实现验收",
};
const phaseNames = {
  planning: "任务规划",
  simulation: "功能仿真",
  timing: "时序诊断",
  cdc: "跨时钟审查",
  ip: "IP 集成",
  recovery: "复核与恢复",
};
const toolNames = {
  eda_preflight: "检查本地环境",
  eda_sop: "读取操作流程",
  eda_results_verify: "核验历史证据",
  eda_xsim: "RTL 功能仿真",
  eda_vivado_synthesize: "设计综合",
  eda_vivado_implement: "布局与布线",
  eda_vivado_report_drc: "设计规则检查",
  eda_task_context: "检索任务上下文",
  eda_workflow_run: "工程任务",
  eda_workflow_plan: "工程计划",
  "pi-sdk-agent": "Pi Agent 会话",
};
const specs = {
  "offline-review": {
    title: "历史工程证据复核",
    description:
      "核对本地配置、操作流程和保留的复杂项目证据。适合先跑通任务闭环。",
    scope: "只读本地证据",
    icon: "shield",
  },
  "counter-simulation": {
    title: "Counter 功能仿真",
    description: "固定 RTL 与 checker，执行 XSim，检查计数、复位、保持和回绕。",
    scope: "真实 XSim 仿真",
    icon: "wave",
  },
  "axi-fabric-ooc": {
    title: "AXI 3×3 系统实现",
    description: "从系统级仿真到综合、布局布线与 DRC，分别核验功能和实现质量。",
    scope: "真实 Vivado 工程",
    icon: "chip",
  },
};
const suiteNames = {
  "offline-agent-loop": "Agent 闭环场景",
  "offline-contracts": "Agent 机制回归",
  "offline-retrieval": "RAG 检索质量",
  "offline-evidence": "历史证据完整性",
  "online-counter": "RTL 功能验证",
  "online-axi": "AXI 系统实现",
  "online-agent": "Agent 端到端验收",
};
const suiteDescriptions = {
  "offline-agent-loop": "按隔离、检索、恢复、预算、占用、完整性、交付和工具边界分类检查。使用模拟后端，不计为 RTL 成绩。",
  "offline-contracts":
    "检查工具契约、任务验收、失败恢复和资源租约。使用假 EDA 后端与本机进程。",
  "offline-retrieval":
    "使用 24 条可见中英文问题，检查相关规则命中及无关问题拒绝。",
  "offline-evidence": "核验历史功能记录、公开证据及本机可用原件的哈希。",
  "online-counter":
    "运行固定 Counter checker，由执行框架回读结果，核验功能是否满足规格。",
  "online-axi":
    "运行 AXI 仿真、综合、布线与严格 DRC 审查，保留每个领域的独立结论。",
  "online-agent":
    "核验真实 Pi 会话及其直接关联的工程任务。需要已有会话和工作流证据。",
};
const unitNames = {
  synthetic_scenario: "模拟任务场景",
  software_test: "软件检查",
  case_variant: "案例变体",
  project_domain: "工程验收项",
  visible_query: "可见检索问题",
  scorecard_integrity: "成绩记录",
  workflow_run: "工程任务",
  session_task: "会话任务",
};
const categoryNames = {
  "rtl.combinational": "组合逻辑",
  "rtl.sequential": "时序逻辑",
  "rtl.fsm": "状态机",
  protocol: "通信协议",
  bus: "总线互连",
  memory: "存储系统",
  arithmetic: "算术运算",
  dsp: "数字信号处理",
  system: "系统工程",
  analog: "模拟电路",
  tool_error: "工具错误处理",
  timeout: "超时处理",
  trace: "执行追踪",
  reproducibility: "复现与证据",
};
const tierNames = {
  smoke: "冒烟检查",
  light: "模块级",
  system: "系统级",
  implementation: "实现与时序",
  external: "外部基准",
};
const categoryLabel = (value) =>
  categoryNames[value] || tierNames[value] || value;
const eventNames = {
  run_started: "开始执行",
  run_finished: "执行结束",
  workflow_started: "工程任务开始",
  workflow_step_started: "开始步骤",
  workflow_step_finished: "步骤结束",
  workflow_step_completed: "步骤完成",
  workflow_completed: "工程任务完成",
  tool_execution_start: "开始调用工具",
  tool_execution_end: "工具返回",
  task_acceptance: "核验工程目标",
  task_outcome: "核验工程目标",
  terminal: "执行结束",
  session_created: "创建会话",
  task_planned: "任务计划已保存",
  job_started: "开始执行任务",
  job_finished: "任务执行结束",
  message_saved: "保存会话消息",
  cancel_requested: "请求停止任务",
};
const state = {
  overview: null,
  view: "sessions",
  id: "",
  session: null,
  run: null,
  routeVersion: 0,
  archive: false,
  sessionQuery: "",
  drafts: {},
  phase: "planning",
  sending: false,
  interaction: "local",
  live: new Map(),
  stream: null,
  evalLane: "tool_execution",
  evaluations: null,
  testing: null,
  testingFilters: { query: "", category: "", tier: "", family: "", status: "" },
  projects: null,
  project: null,
  projectQuery: "",
  projectFilter: "implemented",
  projectFileFilter: "all",
  projectFileQuery: "",
  projectSource: null,
  projectSourceVersion: 0,
  projectSelections: new Map(),
  changes: [],
  change: null,
  runTab: "acceptance",
  runFilter: "workflow",
  runQuery: "",
  contexts: new Map(),
  tasks: new Map(),
  eventsAfter: new Map(),
  pollBusy: false,
  drawerReturn: null,
};
try {
  state.drafts = JSON.parse(
    localStorage.getItem("eda.workbench.drafts") || "{}",
  );
} catch {}
function saveDraft() {
  try {
    localStorage.setItem("eda.workbench.drafts", JSON.stringify(state.drafts));
  } catch {}
}
function date(value, timeOnly = false) {
  if (!value || !Number.isFinite(Date.parse(value))) return "时间未记录";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Singapore",
    ...(timeOnly ? {} : { month: "2-digit", day: "2-digit" }),
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
}
function basename(value) {
  return (
    String(value || "")
      .split(/[\\/]/)
      .filter(Boolean)
      .at(-1) || ""
  );
}
function duration(start, end) {
  if (!start || !end) return "";
  const n = Math.max(
    0,
    Math.round((Date.parse(end) - Date.parse(start)) / 1000),
  );
  return Number.isFinite(n)
    ? n < 60
      ? `${n} 秒`
      : `${Math.floor(n / 60)} 分 ${n % 60} 秒`
    : "";
}
async function api(route, data) {
  const response = await fetch(
    "/api/" + route,
    data === undefined
      ? {}
      : {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
  ).catch((error) => {
    setConnection(false);
    throw error;
  });
  setConnection(true);
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error("本地服务未返回有效响应，请刷新重试。");
  }
  if (!response.ok)
    throw new Error(result.error || `请求失败 (${response.status})`);
  return result;
}
function setConnection(connected) {
  state.connected = connected;
  const row = document.querySelector(".connection-row");
  if (!row) return;
  row.classList.toggle(
    "disconnected",
    !connected || Boolean(state.streamReconnecting),
  );
  row.querySelector("span:last-child").textContent = !connected
    ? "连接断开，正在重连…"
    : state.streamReconnecting
      ? "实时更新正在重连…"
      : "本地工作区已连接";
}
function toast(text, error = false) {
  const el = $("#toast");
  el.textContent = text;
  el.classList.toggle("error", error);
  el.hidden = false;
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    el.hidden = true;
  }, 5500);
}
const guard = (fn) => async (event) => {
  try {
    await fn(event);
  } catch (error) {
    toast(error.message, true);
  }
};
function go(view, id = "") {
  const hash = "#/" + view + (id ? "/" + encodeURIComponent(id) : "");
  if (location.hash === hash) void renderRoute();
  else location.hash = hash;
  $("#app").classList.remove("rail-open");
}
function parseRoute() {
  const [view = "projects", id = ""] = location.hash
    .replace(/^#\/?/, "")
    .split("/");
  return {
    view: ["sessions", "projects", "runs", "knowledge", "evaluations"].includes(
      view,
    )
      ? view
      : "projects",
    id: decodeURIComponent(id),
  };
}
async function refreshOverview() {
  state.overview = await api("overview");
  return state.overview;
}
function button(action, label, name, extra = "", kind = "") {
  return `<button class="button ${kind}" data-action="${action}" ${extra}>${name ? icon(name) : ""}${esc(label)}</button>`;
}
function iconButton(action, label, name, extra = "") {
  return `<button class="icon-button" data-action="${action}" aria-label="${esc(label)}" title="${esc(label)}" ${extra}>${icon(name)}</button>`;
}
function empty(title, detail, name = "folder", action = "") {
  return `<div class="empty-state">${icon(name)}<h2>${esc(title)}</h2><p>${esc(detail)}</p>${action}</div>`;
}
function sourceLink(source) {
  try {
    const url = new URL(source.url);
    if (url.protocol === "https:")
      return `<a href="${esc(url.href)}" target="_blank" rel="noreferrer">${esc(source.title || source.section || source.source_id || url.hostname)}</a>`;
  } catch {}
  return `<span>${esc(source.title || source.source_id || "本地来源")}</span>`;
}
function renderSidebar() {
  const o = state.overview;
  if (!o) return;
  const nav = [
    ["projects", "工程", "chip"],
    ["sessions", "Agent 会话", "chat"],
    ["runs", "执行记录", "runs"],
    ["knowledge", "知识与流程", "book"],
    ["evaluations", "Test Explorer", "chart"],
  ];
  $("#sidebar").innerHTML =
    `<div class="brand"><span class="brand-mark">${icon("chip")}</span><div>EDA Agent<span class="brand-sub">FPGA 工作台</span></div></div>${button("new-session", "新建会话", "plus", "", "new-session")}<nav class="main-nav" aria-label="主要页面">${nav.map(([id, label, i]) => `<button class="nav-item ${state.view === id ? "active" : ""}" data-action="navigate" data-view="${id}" ${state.view === id ? 'aria-current="page"' : ""}>${icon(i)}<span>${label}</span>${id === "runs" ? `<span class="count">${o.runs.filter((r) => r.workflow).length}</span>` : ""}</button>`).join("")}</nav><div class="session-section-heading"><span>${state.archive ? "已归档会话" : "最近会话"}</span><button data-action="toggle-archive">${state.archive ? "返回活跃" : "查看归档"}</button></div><label class="session-search">${icon("search")}<input id="session-search" aria-label="搜索会话" placeholder="搜索会话" value="${esc(state.sessionQuery)}"></label><div id="session-list" class="session-list"></div><div class="rail-footer"><div class="connection-row"><span class="dot"></span><span>本地工作区已连接</span></div>${button("settings", "运行模式与连接", "settings", "", "subtle")}</div>`;
  renderSessionList();
  setConnection(state.connected !== false);
}
function renderSessionList() {
  if (!$("#session-list")) return;
  const sessions = state.overview.sessions.filter(
    (s) =>
      Boolean(s.archived || s.archived_at) === state.archive &&
      String(s.title || "")
        .toLowerCase()
        .includes(state.sessionQuery.toLowerCase()),
  );
  $("#session-list").innerHTML = sessions.length
    ? sessions
        .map(
          (s) =>
            `<div class="session-row ${state.view === "sessions" && state.id === s.id ? "active" : ""}"><button class="session-select" data-action="select-session" data-id="${esc(s.id)}" ${state.id === s.id ? 'aria-current="true"' : ""}><span class="truncate">${esc(s.title || "新会话")}</span><small>${date(s.updated_at)}</small></button><span class="session-actions">${iconButton("session-menu", "会话操作", "more", `data-id="${esc(s.id)}"`)}</span></div>`,
        )
        .join("")
    : `<p class="sidebar-empty">${state.sessionQuery ? "没有匹配的会话。" : state.archive ? "归档会话会保留在这里。" : "任务、消息和执行证据<br>会保存在每个会话中。"}</p>`;
}
function renderHeader(title, subtitle = "", actions = "") {
  $("#page-header").innerHTML =
    `${iconButton("toggle-rail", "打开导航", "menu").replace('class="icon-button"', 'class="icon-button mobile-menu"')}<div class="header-title"><h1 class="truncate">${esc(title)}</h1>${subtitle ? `<p>${esc(subtitle)}</p>` : ""}</div><div class="header-actions"><span class="mode-label">${icon("shield")}<span>${state.overview?.config.model_api_enabled ? "本地工具流程" : "本地流程模式"}</span></span>${actions ? '<span class="header-divider"></span>' + actions : ""}</div>`;
}
function welcome() {
  return `<section class="conversation-empty"><h2>Agent 会话</h2><p>输入工程目标或报告问题。任务计划、工具结果与引用会保存在本会话。</p><small>${state.overview.config.model_api_enabled ? "可切换 Pi Agent" : "模型 API 已停用 · 本地检索与工程流程可用"}</small></section>`;
}
function contextHtml(context, key) {
  state.contexts.set(key, context);
  const rules = context.rules || [],
    sops = context.sops || [];
  return `<p class="message-intro">${rules.length ? `已整理与任务相关的 ${rules.length} 条规则${sops.length ? `，并选出 ${sops.length} 个操作流程` : ""}。执行前请确认适用范围与验收证据。` : "知识库中没有匹配的规则。可以补充器件、接口、时钟或具体错误，再次检索。"}</p><ul class="context-rules">${rules
    .slice(0, 3)
    .map(
      (r) =>
        `<li><strong>${esc(r.title)}</strong><p>${esc(r.statement)}</p></li>`,
    )
    .join(
      "",
    )}</ul>${sops.length ? `<div class="context-callout"><p>建议流程：${sops.map((s) => esc(s.sop.title)).join("、")}</p></div>` : ""}<div class="context-actions">${button("context-detail", "查看规则与来源", "book", `data-key="${esc(key)}"`)}${sops.map((s) => button("sop", s.sop.title, "file", `data-id="${esc(s.sop.id)}"`)).join("")}${button("templates", "准备工程任务", "flow")}</div><p class="context-footer">本地检索结果 · 尚未执行工程工具${context.context_budget ? ` · 选取 ${context.context_budget.selected_tools} 个相关工具` : ""}</p>`;
}
function taskHtml(task) {
  state.tasks.set(task.id, task);
  const plan = task.plan || {},
    spec = plan.spec || {},
    meta = specs[task.spec] || {
      title: task.title || "自定义工程任务",
      scope: "工程规格",
    },
    running = ["running", "queued", "cancel_requested"].includes(task.status),
    planned = ["planned", "awaiting_confirmation"].includes(task.status),
    result = task.result || {},
    dir = result.directory || task.directory;
  return `<article class="task-card" data-task-card="${esc(task.id)}"><div class="task-head"><span class="task-symbol">${icon(meta.icon || "flow")}</span><div><h3>${esc(meta.title)}</h3><p>${esc(meta.scope)}${spec.acceptance?.profile ? " · " + esc(profileNames[spec.acceptance.profile] || spec.acceptance.profile) : ""}</p></div>${badge(task.status)}</div><div class="task-content"><ol class="task-steps">${(spec.steps || []).map((step, i) => `<li><span class="step-marker">${i + 1}</span>${esc(toolNames[step.tool] || step.id)}</li>`).join("")}</ol><div class="task-facts"><span>${Object.keys(plan.input_hashes || {}).length} 个固定输入</span><span>最多 ${spec.limits?.max_calls ?? "—"} 次调用</span><span>${spec.limits?.wall_seconds ?? "—"} 秒预算</span></div>${result.task_acceptance ? `<div class="job-summary">工程验收 ${badge(result.task_acceptance.status)}</div>` : ""}${task.error ? `<p class="job-summary">${esc(task.error)}</p>` : ""}</div><div class="task-actions">${planned ? button("run-task", "确认并执行", "play", `data-id="${esc(task.id)}"`, "primary") : running ? button("cancel-job", task.status === "cancel_requested" ? "正在停止" : "停止任务", "stop", `data-id="${esc(task.job_id)}" ${task.status === "cancel_requested" ? "disabled" : ""}`) : dir ? button("open-run", "查看验收结果", "runs", `data-id="${esc(basename(dir))}"`) : ""}${button("task-detail", "计划详情", null, `data-id="${esc(task.id)}"`, "subtle")}<small>${planned ? "已保存输入指纹；执行前再次核验。" : running ? "工具在本机运行，状态持续保存。" : task.status === "completed" ? "执行结束；工程目标单独验收。" : "记录与失败证据已保留。"}</small></div></article>`;
}
function messagesHtml() {
  const s = state.session,
    messages = s?.messages || [],
    tasks = new Map((s?.tasks || []).map((t) => [t.id, t]));
  const included = new Set();
  const output = messages
    .map((m, index) => {
      let body,
        label,
        avatar,
        kind = m.role;
      if (m.role === "change") {
        body = `<div class="context-callout"><p>${esc(m.text || "限定范围的工程修改")}</p></div>${button("change-open", "查看修改草案", "file", `data-id="${esc(m.change_id)}"`)}`;
        label = "工程修改";
        avatar = icon("file");
      } else if (m.role === "task") {
        const t = tasks.get(m.task_id);
        if (!t) return "";
        included.add(t.id);
        body = taskHtml(t);
        label = "工程任务";
        avatar = icon("flow");
      } else if (m.context) {
        body = contextHtml(m.context, `${s.id}:${index}`);
        label = "本地上下文";
        avatar = icon("chip");
        kind = "context";
      } else {
        body = `<div class="message-text">${esc(m.text || m.content || "")}</div>`;
        label =
          m.role === "user"
            ? "你"
            : m.role === "error"
              ? "执行提示"
              : m.role === "assistant"
                ? "Agent"
                : "工作区";
        avatar = m.role === "user" ? "你" : icon("chip");
      }
      return `<article class="message ${esc(kind)}"><span class="avatar ${m.role === "user" ? "user" : ""}">${avatar}</span><div><div class="message-meta"><strong>${label}</strong><time>${date(m.at || m.created_at, true)}</time></div><div class="message-body">${body}</div></div></article>`;
    })
    .join("");
  return (
    output +
    [...tasks.values()]
      .filter((t) => !included.has(t.id))
      .map(
        (t) =>
          `<article class="message task"><span class="avatar">${icon("flow")}</span><div><div class="message-meta"><strong>工程任务</strong></div>${taskHtml(t)}</div></article>`,
      )
      .join("") +
    liveMessagesHtml() +
    (state.sending
      ? '<div class="inline-loading"><span class="spinner"></span>正在检索规则并整理任务上下文…</div>'
      : "")
  );
}
function liveMessagesHtml() {
  const live = state.live.get(state.id);
  if (!live) return "";
  const saved = (state.session?.messages || []).some(
    (m) => m.role === "assistant" && m.text === live.text,
  );
  const active = (state.overview.jobs || []).find(
    (j) =>
      j.session_id === state.id &&
      j.kind === "agent" &&
      ["running", "cancel_requested"].includes(j.status),
  );
  if (saved && !active) return "";
  if (!live.text && !active) return "";
  return `<article class="message assistant live-agent" data-live-run="${esc(live.run_id)}"><span class="avatar">${icon("chip")}</span><div><div class="message-meta"><strong>Pi Agent</strong><span class="meta live-status">${active ? "实时输出" : live.status === "completed" ? "回复完成" : "回复已停止"}</span>${active && active.controllable !== false ? button("cancel-job", "停止", "stop", `data-id="${esc(active.id)}"`, "subtle") : ""}</div><div class="message-body message-text live-text">${saved ? "" : esc(live.text)}</div><div class="live-tools" ${live.tools?.length ? "" : "hidden"}>${liveToolsHtml(live)}</div><div class="live-verifier">${verifierStateHtml(live.verifier)}</div></div></article>`;
}
function liveToolsHtml(live) {
  return (live.tools || [])
    .slice(-4)
    .map(
      (t) =>
        `<p>${icon(t.done ? "check" : "tool")}${esc(toolNames[t.name] || t.name)}${t.failed ? " · 失败" : t.done ? " · 已返回" : " · 执行中"}</p>`,
    )
    .join("");
}
function verifierStateHtml(value) {
  if (!value) return "";
  const phases={generating:"分析与修复 RTL",verifying:"独立工具验证",boundary:"验证回合已记录",delivery:"交付复核"};
  return `<div class="verifier-state" role="status"><div class="row"><strong>${esc(phases[value.decision?.phase] || "工程验收")}</strong>${badge(value.task_acceptance?.status || "unknown")}</div><div class="verifier-domains">${(value.task_acceptance?.domains||[]).filter(d=>!["not_requested","not_evaluated"].includes(d.status)).map(d=>`<span>${esc(domainNames[d.domain]||d.domain)} ${badge(d.status)}</span>`).join("")}</div><p class="meta">已记录 ${value.verifier_rounds || 0} 轮 · 验证调用 ${value.budget?.used_calls ?? 0} / ${value.budget?.max_calls ?? "—"}</p>${value.guidance?.sop_ids?.length?`<p class="meta">当前流程：${esc(value.guidance.sop_ids.join("、"))}</p>`:""}</div>`;
}
function updateLiveDisplay(live) {
  const row = document.querySelector(".live-agent");
  if (!row || row.dataset.liveRun !== live.run_id) return renderMessages();
  const scroller = $("#conversation-scroll");
  const atLatest =
    scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 75;
  row.querySelector(".live-text").textContent = live.text;
  const tools = row.querySelector(".live-tools");
  const toolHtml = liveToolsHtml(live);
  if (tools.innerHTML !== toolHtml) tools.innerHTML = toolHtml;
  tools.hidden = !live.tools.length;
  let verifier=row.querySelector('.live-verifier');
  if(!verifier){verifier=document.createElement('div');verifier.className='live-verifier';tools.after(verifier);}
  verifier.innerHTML=verifierStateHtml(live.verifier);
  if (!["running", "queued"].includes(live.status)) {
    row.querySelector(".live-status").textContent =
      live.status === "completed" ? "回复完成" : "回复已停止";
    row.querySelector('[data-action="cancel-job"]')?.remove();
  }
  if (atLatest) scroller.scrollTop = scroller.scrollHeight;
}
function openSessionStream(id, version) {
  state.stream?.close();
  state.stream = null;
  if (!id) return;
  const after = state.eventsAfter.get(id) || 0;
  const stream = new EventSource(
    "/api/events?session_id=" +
      encodeURIComponent(id) +
      "&format=sse&after=" +
      after,
  );
  state.stream = stream;
  stream.onopen = () => {
    if (state.stream === stream) {
      state.streamReconnecting = false;
      setConnection(true);
    }
  };
  stream.onerror = () => {
    if (state.stream === stream) {
      state.streamReconnecting = true;
      setConnection(state.connected !== false);
    }
  };
  stream.addEventListener("update", (event) => {
    if (version !== state.routeVersion || id !== state.id) return;
    let row;
    try {
      row = JSON.parse(event.data);
    } catch {
      return;
    }
    if (
      row.session_id !== id ||
      row.sequence <= (state.eventsAfter.get(id) || 0)
    )
      return;
    state.eventsAfter.set(id, row.sequence);
    if (row.type === "job_finished" && state.live.has(id)) {
      const live = state.live.get(id);
      live.status = row.status;
      updateLiveDisplay(live);
    }
    if (row.type !== "agent_event") return;
    const e = row.event;
    if (!e?.run_id) return;
    let live = state.live.get(id);
    if (!live || live.run_id !== e.run_id)
      live = { run_id: e.run_id, text: "", tools: [], status: "running" };
    if (e.type === "text_delta") {
      if (live.messageEnded) {
        live.text = "";
        live.messageEnded = false;
      }
      live.text += e.text || "";
    } else if (e.type === "assistant_message") {
      live.text = e.text || "";
      live.messageEnded = true;
    } else if (e.type === "tool_execution_start")
      live.tools.push({ id: e.toolCallId, name: e.toolName, done: false });
    else if (e.type === "tool_execution_end") {
      const tool = live.tools.find((t) => t.id === e.toolCallId);
      if (tool) {
        tool.done = true;
        tool.failed = e.isError;
      }
    } else if (e.type === "eda_task_state") live.verifier=e;
    else if(e.type === "task_delivery") {live.text=e.text;live.messageEnded=true;}
    else if (e.type === "run_end") live.status = e.status;
    state.live.set(id, live);
    updateLiveDisplay(live);
  });
}
async function sendAgentMessage() {
  if (!state.overview.config.model_api_enabled)
    throw new Error("模型 API 已停用，请使用本地上下文模式。");
  const input = $("#message-input"),
    message = input?.value.trim();
  if (!message) return;
  const version = state.routeVersion,
    target = state.id;
  state.sending = true;
  $('#composer button[type="submit"]').disabled = true;
  try {
    const session = target
      ? state.session
      : await api("session", { action: "create", title: message.slice(0, 60) });
    await api("agent", { session_id: session.id, message,
      resumeTask:session.agent_task_summary?.status==='cancelled'&&session.agent_task_summary?.recovery?.ready===true });
    state.drafts[target || "new"] = "";
    saveDraft();
    await refreshOverview();
    if (version !== state.routeVersion) return;
    if (!target) go("sessions", session.id);
    else {
      state.session = await api("session?id=" + encodeURIComponent(target));
      input.value = "";
      renderMessages({ scroll: true });
    }
  } finally {
    state.sending = false;
    if (version === state.routeVersion) {
      const button = $('#composer button[type="submit"]');
      if (button) button.disabled = false;
    }
  }
}
function renderMessages({ scroll = false } = {}) {
  const list = $("#conversation-scroll");
  if (!list) return;
  const oldTop = list.scrollTop,
    atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 75;
  list.innerHTML =
    state.session?.messages?.length ||
    state.session?.tasks?.length ||
    state.live.has(state.id)
      ? `<div class="conversation-inner">${messagesHtml()}</div>`
      : welcome();
  if (scroll || atBottom) list.scrollTop = list.scrollHeight;
  else list.scrollTop = oldTop;
}
function renderConversation() {
  const s = state.session,
    archived = Boolean(s?.archived || s?.archived_at);
  renderHeader(
    s?.title || "新会话",
    s ? "会话内容与工程证据保存在本机" : "从任务讨论到工程验收",
    button("agent-task", "验证任务", "shield") + button("templates", "工程任务", "plus") +
      (s
        ? iconButton(
            "session-menu",
            "会话操作",
            "more",
            `data-id="${esc(s.id)}"`,
          )
        : ""),
  );
  $("#content").className = "content conversation-content";
  $("#content").innerHTML =
    `<div id="conversation-scroll" class="conversation-scroll"></div><div class="composer-wrap">${agentTaskStripHtml(s?.agent_task_summary)}${
      archived
        ? `<div class="composer"><div class="row"><span class="meta">该会话已归档。恢复后可以继续任务。</span><span class="spacer"></span>${button("restore-session", "恢复会话", "archive", `data-id="${esc(s.id)}"`)}</div></div>`
        : `<form id="composer" class="composer"><label class="sr-only" for="message-input">会话消息</label><textarea id="message-input" rows="2" maxlength="2048" placeholder="描述设计目标，或粘贴需要排查的工程问题…">${esc(state.drafts[state.id || "new"] || "")}</textarea><div class="composer-footer"><label class="composer-select">${icon("flow")}<select id="phase-select" aria-label="任务阶段">${Object.entries(
            phaseNames,
          )
            .map(
              ([id, label]) =>
                `<option value="${id}" ${state.phase === id ? "selected" : ""}>${label}</option>`,
            )
            .join(
              "",
            )}</select></label><label class="composer-select">${icon("shield")}<select id="interaction-mode" aria-label="对话模式"><option value="local" ${state.interaction === "local" ? "selected" : ""}>本地上下文</option><option value="agent" ${state.interaction === "agent" ? "selected" : ""} ${state.overview.config.model_api_enabled ? "" : "disabled"}>${state.overview.config.model_api_enabled ? "Pi Agent" : "Pi Agent（模型已停用）"}</option></select></label><button class="send-button" type="submit" aria-label="发送消息" title="发送消息" ${state.sending ? "disabled" : ""}>${icon("arrow")}</button></div></form>`
    }<p class="composer-hint">Enter 发送，Shift + Enter 换行 · 本地模式不生成模型回复 · 工程执行需先确认计划</p></div>`;
  renderMessages({ scroll: true });
  syncComposerMode();
}
function agentTaskStripHtml(task) {
  return task ? `<div class="agent-task-strip"><span>${icon("shield")}<strong>${esc(task.goal || "验证任务")}</strong>${badge(task.task_acceptance?.status || "unknown")}</span>${button("agent-task-details","范围与证据","file","","subtle")}</div>` : "";
}
function updateAgentTaskStrip() {
  const current = document.querySelector('.agent-task-strip'), html = agentTaskStripHtml(state.session?.agent_task_summary);
  if (current) { if (html) current.outerHTML = html; else current.remove(); }
  else if (html) document.querySelector('.composer-wrap')?.insertAdjacentHTML('afterbegin', html);
}
function syncComposerMode() {
  const agent = state.interaction === "agent";
  const hint = document.querySelector(".composer-hint");
  if (hint)
    hint.textContent = agent
      ? "Enter 发送，Shift + Enter 换行 · Pi Agent 使用已配置模型 · 公开回复与工具进度实时保存"
      : "Enter 发送，Shift + Enter 换行 · 本地模式不生成模型回复 · 工程执行需先确认计划";
  const input = document.querySelector("#message-input");
  if (input)
    input.placeholder = agent
      ? "向 Pi Agent 描述工程目标、输入与验收条件…"
      : "描述设计目标，或粘贴需要排查的工程问题…";
  const label = document.querySelector(".mode-label span");
  if (label) label.textContent = agent ? "Pi Agent 会话" : "本地流程模式";
}
async function newSession() {
  const session = await api("session", { action: "create", title: "新会话" });
  state.session = session;
  await refreshOverview();
  go("sessions", session.id);
}
async function ensureSession({navigate = true} = {}) {
  if (
    state.view === "sessions" &&
    state.session &&
    !state.session.archived &&
    !state.session.archived_at
  )
    return state.session;
  const s = await api("session", { action: "create", title: "工程任务" });
  state.session = s;
  await refreshOverview();
  if (navigate) go("sessions", s.id);
  return s;
}
async function sendMessage(event) {
  event.preventDefault();
  if (state.sending) return;
  if (state.interaction === "agent") return sendAgentMessage();
  const message = $("#message-input")?.value.trim();
  if (!message) return;
  const target = state.id,
    version = state.routeVersion,
    phase = $("#phase-select").value;
  state.sending = true;
  $('#composer button[type="submit"]').disabled = true;
  try {
    const s = await api("session", {
      ...(target ? { id: target } : {}),
      message,
      phase,
    });
    state.drafts[target || "new"] = "";
    saveDraft();
    await refreshOverview();
    if (state.routeVersion !== version) return;
    if (!target) {
      state.session = s;
      go("sessions", s.id);
    } else {
      state.session = s;
      $("#message-input").value = "";
      renderMessages({ scroll: true });
      renderSidebar();
      renderHeader(
        s.title,
        "会话内容与工程证据保存在本机",
        button("templates", "工程任务", "plus") +
          iconButton(
            "session-menu",
            "会话操作",
            "more",
            `data-id="${esc(s.id)}"`,
          ),
      );
    }
  } finally {
    state.sending = false;
    if (state.routeVersion === version) {
      const b = $('#composer button[type="submit"]');
      if (b) b.disabled = false;
      renderMessages({ scroll: true });
    }
  }
}
function openDrawer(title, body, { wide = false } = {}) {
  state.drawerReturn = document.activeElement;
  $("#drawer-host").innerHTML =
    `<div class="drawer-backdrop" data-action="close-drawer"></div><section class="drawer ${wide ? "wide" : ""}" role="dialog" aria-modal="true" aria-labelledby="drawer-title"><header class="drawer-header"><h2 id="drawer-title">${esc(title)}</h2>${iconButton("close-drawer", "关闭详情", "close")}</header><div class="drawer-body">${body}</div></section>`;
  $(".drawer .icon-button").focus();
  $("#workspace").inert = true;
  $("#sidebar").inert = true;
}
function closeDrawer() {
  $("#drawer-host").innerHTML = "";
  $("#workspace").inert = false;
  $("#sidebar").inert = false;
  if (state.drawerReturn?.isConnected) state.drawerReturn.focus();
}
function templatesDrawer() {
  openDrawer(
    "准备工程任务",
    `<p>选择一项已固定输入和验收条件的任务。先查看计划，再确认执行；每次运行保存独立证据。</p>${Object.entries(
      specs,
    )
      .map(
        ([id, s]) =>
          `<article class="template-card"><h3>${s.title}</h3><p>${s.description}</p><div class="row"><span class="meta">${s.scope}</span>${button("plan-template", "准备计划", "plus", `data-spec="${id}"`)}</div></article>`,
      )
      .join(
        "",
      )}<h3>使用自己的工程规格</h3><p class="meta">填写工作区 examples/workflows 或 projects 中的工作流 JSON 路径，复用已声明的 RTL、XDC、器件、检查和预算。</p><form id="custom-plan" class="form-grid"><label>工程规格路径<input id="custom-spec" placeholder="projects/my-fpga/workflow.json" required></label>${button("submit-custom-plan", "读取规格并准备计划", "file", 'type="submit"')}</form>`,
  );
}
function agentTaskDrawer() {
  openDrawer("固定验证任务",`<p>指定 examples/workflows 或 projects 下的验收规格和可修改的 RTL。工作台会创建候选副本；测试文件、约束、器件和验收检查一起冻结。</p><form id="agent-task-form" class="form-grid"><label>验收规格<input id="agent-task-spec" required value="examples/workflows/counter-simulation.json" placeholder="projects/my-fpga/workflow.json"></label><label>可修改的 RTL（每行一个路径）<textarea id="agent-task-editable" rows="3" required>examples/digital/counter.v</textarea></label><div class="row"><label>最多修复轮次<input id="agent-task-rounds" type="number" min="1" max="8" value="4" required></label><label>累计验证调用<input id="agent-task-calls" type="number" min="1" max="100" value="8" required></label></div><p class="meta">准备任务只复制并核对文件。开始修复后，Agent 分析和修改候选，固定工具检查决定结果。</p><button type="submit" class="button primary">创建候选并固定范围</button></form>`);
}
async function prepareAgentTaskFromForm() {
  const configuration={spec:$('#agent-task-spec').value.trim(),editable_sources:$('#agent-task-editable').value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean),max_rounds:Number($('#agent-task-rounds').value),max_calls:Number($('#agent-task-calls').value)};
  // Keep the form and its values while the first session is created. Navigate
  // only after admission succeeds, so a server validation error remains editable.
  const session=await ensureSession({navigate:false});
  await api('agent-task',{action:'prepare',session_id:session.id,configuration});
  state.session=await api('session?id='+encodeURIComponent(session.id));
  closeDrawer();
  history.replaceState(null,'','#/sessions/'+encodeURIComponent(session.id));
  await renderRoute();
  if(state.id===session.id)await agentTaskDetails();
}
async function agentTaskDetails() {
  if(!state.session?.agent_task)return agentTaskDrawer();
  state.session=await api('session?id='+encodeURIComponent(state.session.id));
  const task=state.session.agent_task_summary;
  const canRun=state.overview.config.model_api_enabled && ['prepared','cancelled'].includes(task.status) && task.recovery?.ready;
  openDrawer('验证任务与候选 RTL',`<h3>${esc(task.goal||'任务待复核')}</h3><div class="row">${badge(task.status)}${badge(task.task_acceptance?.status||'unknown')}</div><dl class="definition-list"><dt>候选目录</dt><dd><code>${esc(task.candidate)}</code></dd><dt>已验证轮次</dt><dd>${task.rounds||0}</dd><dt>验证调用</dt><dd>${task.calls||0}</dd><dt>恢复条件</dt><dd>${esc(task.recovery?.ready?'已满足':task.recovery?.reason)}</dd></dl><h3>允许修改的 RTL</h3>${(task.editable_sources||[]).map(file=>`<p><code>${esc(file)}</code></p>`).join('')}<h3>独立验收</h3><div class="verifier-domains">${(task.task_acceptance?.domains||[]).filter(d=>!['not_requested','not_evaluated'].includes(d.status)).map(d=>`<span>${esc(domainNames[d.domain]||d.domain)} ${badge(d.status)}</span>`).join('')||'<p class="meta">尚未执行独立验证。</p>'}</div>${task.issues?.length?`<p class="notice">${esc(task.issues.join('; '))}</p>`:''}${task.evidence?button('open-run','查看验证证据','file',`data-id="${esc(basename(task.evidence))}"`):''}<div class="row">${button('agent-task-start',task.status==='cancelled'?'续接修复':'开始修复','play',canRun?'':'disabled','primary')}${button('agent-task-detach','解除会话绑定','close')}</div>${!state.overview.config.model_api_enabled?'<p class="meta">模型 API 当前关闭；候选和验收范围已保存在本机。</p>':''}`);
}
async function startAgentTask() {
  const task=state.session?.agent_task_summary;
  if(!task?.recovery?.ready)throw new Error('请先检查任务恢复条件');
  await api('agent',{session_id:state.session.id,message:`请完成此验证任务：${task.goal}。根据独立验证反馈修复候选 RTL，并交付当前证据。`,resumeTask:task.status==='cancelled'});
  state.interaction='agent';
  closeDrawer();await refreshOverview();renderConversation();
}
async function planTask(spec) {
  const session = await ensureSession();
  const result = await api("workflow", {
    action: "plan",
    spec,
    session_id: session.id,
  });
  if (result.task) state.tasks.set(result.task.id, result.task);
  closeDrawer();
  state.session = await api("session?id=" + encodeURIComponent(session.id));
  await refreshOverview();
  if (state.view === "sessions" && state.id === session.id) {
    renderSidebar();
    renderMessages({ scroll: true });
  } else go("sessions", session.id);
  toast("计划已保存。核对输入与验收条件后即可执行。");
}
function planDetails(task) {
  const p = task.plan || {},
    s = p.spec || {};
  openDrawer(
    "工程计划与验收",
    `<h3>${esc(specs[task.spec]?.title || task.title || "工程任务")}</h3><p>${esc(s.goal)}</p><dl class="definition-list"><dt>执行状态</dt><dd>${badge(task.status)}</dd><dt>调用上限</dt><dd>${esc(s.limits?.max_calls ?? "—")} 次</dd><dt>时间预算</dt><dd>${esc(s.limits?.wall_seconds ?? "—")} 秒</dd><dt>验收领域</dt><dd>${esc((p.acceptance?.required || Object.keys(s.acceptance?.bindings || {})).map((d) => domainNames[d] || d).join("、") || "未绑定")}</dd>${s.acceptance?.design ? `<dt>顶层模块</dt><dd>${esc(s.acceptance.design.top)}</dd><dt>目标器件</dt><dd>${esc(s.acceptance.design.part)}</dd><dt>时钟约束</dt><dd>${esc(s.acceptance.design.clock)} / ${esc(s.acceptance.design.period_ns)} ns</dd>` : ""}<dt>选定流程</dt><dd>${esc((p.guidance?.sop_ids || s.guidance?.sop_ids || []).join("、"))}</dd></dl><h3>固定输入</h3>${
      Object.entries(p.input_hashes || {})
        .map(
          ([file, hash]) =>
            `<div class="evidence-link">${icon("file")}<div>${esc(file)}<code>${esc(typeof hash === "string" ? hash : JSON.stringify(hash))}</code></div>`,
        )
        .join("") || '<p class="meta">没有记录固定输入。</p>'
    }<h3>每一步的验收条件</h3>${(s.steps || []).map((step, i) => `<details class="tool-contract"><summary>${i + 1}. ${esc(toolNames[step.tool] || step.id)}</summary><p>${esc(step.tool)}</p><pre>${esc(JSON.stringify({ args: step.args, checks: step.checks }, null, 2))}</pre></details>`).join("")}<p class="technical-note">输入、代码或验收条件变化后，需准备新计划。完成一次执行不等于全部工程目标通过。</p>`,
    { wide: true },
  );
}
async function runTask(id) {
  const t =
    state.tasks.get(id) || (await api("task?id=" + encodeURIComponent(id)));
  const job = await api("workflow", {
    action: "run",
    spec: t.spec,
    session_id: t.session_id,
    plan_id: t.plan_id || t.id,
  });
  await refreshOverview();
  if (state.view === "sessions" && state.id === t.session_id) {
    state.session = await api("session?id=" + encodeURIComponent(state.id));
    renderMessages();
  }
  toast("任务已启动，执行记录将持续保存。");
  return job;
}
function renderContextDetail(key) {
  const c = state.contexts.get(key);
  if (!c) return;
  openDrawer(
    "任务上下文与来源",
    `<p>${esc(c.query)}</p><div class="row wrap">${c.phase ? `<span class="phase-pill">${esc(phaseNames[c.phase] || c.phase)}</span>` : ""}<span class="meta">${c.rules?.length || 0} 条规则 / ${c.sops?.length || 0} 个流程</span></div>${rulesHtml(c.rules, c.sources)}<h3>本任务相关工具</h3><p class="meta">${c.context_budget?.selected_tools || 0} / ${c.context_budget?.available_tools || 0} 个工具。选取上下文后，执行仍使用明确的步骤检查。</p>${(c.tools || []).map((t) => `<details class="tool-contract"><summary>${esc(toolNames[t.name] || t.name)}</summary><p>${esc(t.description)}</p><pre>${esc(JSON.stringify(t.inputSchema, null, 2))}</pre></details>`).join("")}`,
    { wide: true },
  );
}
function rulesHtml(rules = [], sources = []) {
  return rules
    .map(
      (r) =>
        `<article class="rule-card"><h3>${esc(r.title)}</h3><p>${esc(r.statement)}</p><div class="source-list">${(r.source_refs || []).map((ref) => sourceLink({ ...sources.find((s) => s.id === ref.source_id), ...ref })).join("")}</div><details><summary>适用范围与证据要求</summary><p>${esc(r.scope)}${r.versions?.length ? "<br>版本：" + esc(r.versions.join("、")) : ""}</p><p>需要证据：${esc((r.evidence_required || []).join("、"))}</p><p>${esc(r.static_proof_boundary)}</p></details></article>`,
    )
    .join("");
}
function markdown(text) {
  const lines = String(text || "").split(/\r?\n/);
  let code = false;
  return (
    lines
      .map((line) => {
        if (line.startsWith("```")) {
          code = !code;
          return code ? "<pre><code>" : "</code></pre>";
        }
        if (code) return esc(line) + "\n";
        const safe = esc(line)
          .replace(/`([^`]+)`/g, "<code>$1</code>")
          .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
        const h = /^(#{1,3}) (.*)/.exec(safe);
        if (h) return `<h${h[1].length}>${h[2]}</h${h[1].length}>`;
        if (/^\s*[-*] /.test(safe))
          return `<p>• ${safe.replace(/^\s*[-*] /, "")}</p>`;
        return safe ? `<p>${safe}</p>` : "";
      })
      .join("") + (code ? "</code></pre>" : "")
  );
}
async function showSop(id) {
  const result = await api("sop", { id });
  const readable = String(result.content || "")
    .replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "")
    .replace(/^\s*# [^\r\n]+[\r\n]+/, "");
  openDrawer(
    result.sop?.title || "操作流程",
    `<div class="row wrap"><span class="phase-pill">${(result.sop?.required_tools || []).length} 个工具</span><span class="phase-pill">${(result.sop?.required_evidence || []).length} 类验收证据</span></div><div class="markdown-content">${markdown(readable)}</div><details class="tool-contract"><summary>完整来源与元数据</summary><pre>${esc(result.content)}</pre></details>`,
    { wide: true },
  );
}
function renderKnowledge() {
  renderHeader("知识与流程", "按任务阶段检索规则、完整 SOP 和工具契约");
  $("#content").className = "content";
  $("#content").innerHTML =
    `<div class="page"><div class="page-intro"><div><h1>让工程决策有据可查</h1><p>检索相关规则，核对适用版本，再将操作流程带入工程任务。</p></div></div><form id="knowledge-search" class="knowledge-search"><label class="search-box">${icon("search")}<input id="knowledge-query" aria-label="检索知识" placeholder="输入工程问题，例如：异步 FIFO 的跨时钟总线一致性" required maxlength="2048"></label><button class="button primary" type="submit">检索规则</button></form><div class="knowledge-layout"><div id="knowledge-results"><div class="empty-result">${icon("book")}<p>输入具体的设计问题，查看匹配规则及来源。</p><p class="technical-note">检索命中表示相关性；工程结论由实际检查给出。</p></div></div><aside class="knowledge-aside"><h3>完整操作流程</h3>${(state.overview.sops || []).map((s) => `<button class="sop-item" aria-label="${esc(s.title)}" data-action="sop" data-id="${esc(s.id)}"><strong>${esc(s.title)}</strong><small>${(s.required_tools || []).length} 个工具 · ${(s.required_evidence || []).length} 类证据</small></button>`).join("")}<p class="technical-note">每个流程保留所需证据、工具范围和来源版本。</p></aside></div></div>`;
}
function runTitle(r) {
  if (r.workflow) {
    if (r.id?.includes("workflow")) return r.title || "工程工作流";
    return r.title || "工程任务";
  }
  return toolNames[r.tool] || r.tool || "执行记录";
}
function activeJobs() {
  return (state.overview.jobs || []).filter((j) =>
    ["running", "queued", "cancel_requested"].includes(j.status),
  );
}
function busyJobsHtml() {
  return activeJobs()
    .map(
      (j) =>
        `<div class="busy-row"><span class="spinner"></span><div><strong>${esc(suiteNames[j.kind?.split(":")[1]] || specs[j.kind?.split(":")[1]]?.title || j.kind || "正在执行")}</strong><p class="meta">${date(j.started_at)}${j.session_id ? " · 已关联会话" : ""}</p></div>${badge(j.status)}${j.controllable !== false ? button("cancel-job", j.status === "cancel_requested" ? "正在停止" : "停止", "stop", `data-id="${esc(j.id)}" ${j.status === "cancel_requested" ? "disabled" : ""}`) : ""}</div>`,
    )
    .join("");
}
function renderRuns() {
  renderHeader(
    "执行记录",
    "查看每次执行、工程验收与原始证据",
    button("refresh", "刷新", "refresh"),
  );
  $("#content").className = "content";
  $("#content").innerHTML =
    `<div class="page"><div class="page-intro"><div><h1>工程执行记录</h1><p>执行状态、工程目标和证据完整性分别核验。失败与待审查结果会一并保留。</p></div><span class="spacer"></span>${button("templates", "新建工程任务", "plus")}</div><div id="active-jobs">${busyJobsHtml()}</div><div class="toolbar"><label class="search-box">${icon("search")}<input id="run-search" aria-label="搜索执行记录" value="${esc(state.runQuery)}" placeholder="搜索工具或运行编号"></label><select id="run-filter" aria-label="记录类型"><option value="workflow" ${state.runFilter === "workflow" ? "selected" : ""}>工程任务</option><option value="agent" ${state.runFilter === "agent" ? "selected" : ""}>Pi Agent 会话</option><option value="all" ${state.runFilter === "all" ? "selected" : ""}>全部工具记录</option></select></div><div id="run-list"></div></div>`;
  renderRunList();
}
function renderRunList() {
  const runs = state.overview.runs.filter(
    (r) =>
      (state.runFilter === "all" ||
        (state.runFilter === "workflow" && r.workflow) ||
        (state.runFilter === "agent" && r.pi_session)) &&
      `${r.id} ${r.tool} ${r.title || ""}`
        .toLowerCase()
        .includes(state.runQuery.toLowerCase()),
  );
  $("#run-list").innerHTML = runs.length
    ? `<div class="record-list">${runs.map((r) => `<button class="record-row" data-action="open-run" data-id="${esc(r.id)}"><span class="record-icon">${icon(r.workflow ? "flow" : r.pi_session ? "chat" : "tool")}</span><span><strong>${esc(runTitle(r))}</strong><small>${date(r.started_at)} · ${esc(r.workflow ? "独立工程验收" : r.pi_session ? "原生 Pi 运行" : "工具调用")}</small></span>${badge(r.status)}${icon("right")}</button>`).join("")}</div><p class="pagination-note">显示 ${runs.length} 条记录 · 时间为 UTC+8 · 运行编号可在详情中查看</p>`
    : empty(
        "暂无匹配记录",
        "调整筛选条件，或创建一项工程任务。",
        "runs",
        button("templates", "准备工程任务", "plus"),
      );
}
function runDescription(r) {
  const goal = runPurpose(r);
  if (/retained|historical|evidence.*review/i.test(goal))
    return "核对本地模型策略、操作流程与历史工程证据，回读原件和公开文件的哈希。";
  if (/AXI/i.test(goal))
    return "核验 AXI 互连的功能仿真、综合、布局布线和设计规则。每个领域独立给出工程结论。";
  if (/counter/i.test(goal))
    return "执行固定 Counter checker，验证计数、保持、复位与回绕行为。";
  return goal;
}
function runPurpose(r) {
  return (
    r.workflow?.goal ||
    r.prompt ||
    toolNames[r.manifest.tool] ||
    r.manifest.tool ||
    "工程执行"
  );
}
function runName(r) {
  if (r.title) return r.title;
  const text = runPurpose(r);
  if (/AXI/i.test(text)) return "AXI 3×3 系统实现";
  if (/counter/i.test(text)) return "Counter 功能仿真";
  if (/retained|historical|evidence.*review/i.test(text))
    return "历史工程证据复核";
  return r.workflow
    ? "工程工作流"
    : toolNames[r.manifest.tool] || r.manifest.tool;
}
function acceptanceFor(workflow) {
  return workflow?.recorded_acceptance_integrity && workflow.recorded_acceptance
    ? workflow.recorded_acceptance
    : workflow?.task_acceptance;
}
function domainDetail(d) {
  if (["setup", "hold"].includes(d.domain) && typeof d.observed === "number")
    return `时序裕量 ${d.observed >= 0 ? "+" : ""}${d.observed.toFixed(3)} ns`;
  if (d.domain === "drc" && d.observed)
    return `${d.observed.errors ?? "—"} 个错误，${d.observed.critical_warnings ?? "—"} 个严重警告，${d.observed.warnings ?? "—"} 个警告`;
  if (d.domain === "synthesis" && typeof d.observed === "number")
    return `${d.observed} 个未解析黑盒`;
  if (d.domain === "functional" && d.observed?.completion_observed)
    return "固定 checker 标记通过，仿真完整结束。";
  if (d.domain === "constraints" && d.observed?.internal === "pass")
    return "内部时钟与 IO 约束检查通过。";
  if (d.domain === "routing" && d.observed === "pass")
    return "布线报告核验通过。";
  return (
    d.reason ||
    (d.status === "not_requested"
      ? "此任务未要求该领域验收。"
      : "见独立工具报告。")
  );
}
function renderRun() {
  const r = state.run,
    w = r.workflow,
    a = r.agent_task?.current?.task_acceptance || acceptanceFor(w);
  renderHeader(
    runName(r),
    "运行与验收",
    button("run-list", "返回记录", "back") +
      button("run-evidence", "证据详情", "file") +
      iconButton("refresh", "刷新运行", "refresh"),
  );
  $("#content").className = "content";
  $("#content").innerHTML =
    `<div class="page"><div class="run-summary"><span class="summary-symbol">${icon(w ? "flow" : "tool")}</span><div><h2>${esc(runName(r))}</h2><p>${esc(runDescription(r))}</p><div class="run-meta"><span>${date(r.manifest.started_at)}</span><span>${duration(r.manifest.started_at, r.manifest.finished_at)}</span><span>执行：${esc(statusNames[r.manifest.status] || r.manifest.status)}</span></div></div>${badge(a?.status || r.manifest.status)}</div>${w?.valid === false ? '<div class="notice neutral">' + icon("clock") + "<span>当前源码或输入与此运行记录有差异。下方保留当时的验收结果；复用或恢复前需重新核验。</span></div>" : ""}${w?.steps?.length ? `<div class="run-steps">${w.steps.map((s, i) => `<div class="run-step ${(w.completed_steps || []).includes(s.id) ? "done" : ""}"><span class="step-marker">${(w.completed_steps || []).includes(s.id) ? icon("check") : i + 1}</span><strong>${esc(toolNames[s.tool] || s.id)}</strong></div>`).join("")}</div>` : ""}<div class="tabs" role="tablist" aria-label="运行详情">${[
      ["acceptance", "验收结果"],
      ["timeline", "执行时间线"],
      ["info", "运行信息"],
    ]
      .map(
        ([id, label]) =>
          `<button role="tab" aria-selected="${state.runTab === id}" data-action="run-tab" data-tab="${id}" class="${state.runTab === id ? "active" : ""}">${label}</button>`,
      )
      .join("")}</div><div id="run-panel">${runPanel()}</div></div>`;
}
function runPanel() {
  const r = state.run,
    w = r.workflow,
    a = acceptanceFor(w);
  if (state.runTab === "timeline") {
    const events = (r.events || []).filter(
      (e) =>
        ![
          "input_captured",
          "workflow_checkpoint",
          "dependency_unresolved",
        ].includes(e.type),
    );
    return events.length
      ? `<ol class="timeline">${events.map((e) => `<li><time>${date(e.time || e.timestamp_utc, true)}</time><span class="timeline-mark"></span><div><strong>${esc(eventNames[e.type] || e.type)}</strong>${e.status ? badge(e.status) : ""}<p>${esc(toolNames[e.tool] || e.tool || e.step || "")}</p></div></li>`).join("")}</ol>`
      : empty(
          "没有可展示的事件",
          "此历史记录未保存逐步事件。完整性检查仍保留原始结果。",
          "clock",
        );
  }
  if (state.runTab === "info")
    return `<dl class="definition-list"><dt>原始任务目标</dt><dd>${esc(runPurpose(r))}</dd><dt>运行编号</dt><dd><code>${esc(r.id)}</code></dd><dt>执行工具</dt><dd>${esc(r.manifest.tool)}</dd><dt>开始时间</dt><dd>${date(r.manifest.started_at)}</dd><dt>结束时间</dt><dd>${date(r.manifest.finished_at)}</dd><dt>执行状态</dt><dd>${badge(r.manifest.status)}</dd><dt>证据检查</dt><dd>${r.inspection?.valid ? "文件与记录检查通过" : "存在缺失、变化或运行尚未结束"}</dd></dl><div class="notice neutral">${icon("shield")}<span>本地工具流程不调用模型 API。外层 Codex token 未在工作台中计量。</span></div>`;
  if (r.agent_task) {
    const current=r.agent_task.current,recorded=r.agent_task.recorded;
    return `<div class="section-heading"><h2>宿主验证交付</h2>${badge(current.task_acceptance?.status||'unknown')}</div><p>${esc(current.goal||recorded?.goal)}</p><dl class="definition-list"><dt>本次保存的验收</dt><dd>${badge(recorded?.task_acceptance?.status||'unknown')}</dd><dt>任务当前状态</dt><dd>${badge(current.status)}</dd><dt>候选 RTL</dt><dd>${(current.editable_sources||[]).map(file=>`<code>${esc(file)}</code>`).join('<br>')}</dd><dt>已验证轮次</dt><dd>${current.rounds||0}</dd><dt>累计验证调用</dt><dd>${current.calls||0}</dd></dl><div class="verifier-domains">${(current.task_acceptance?.domains||[]).filter(d=>!['not_requested','not_evaluated'].includes(d.status)).map(d=>`<span>${esc(domainNames[d.domain]||d.domain)} ${badge(d.status)}</span>`).join('')}</div>${current.issues?.length?`<p class="notice">${esc(current.issues.join('; '))}</p>`:''}<p class="meta">当前状态重新检查任务最新候选；本次保存的结论保留原记录。查看 delivery.json 与 model-answer.md 可对照宿主结论和模型文字。</p>${current.evidence?button('open-run','查看独立验证','file',`data-id="${esc(basename(current.evidence))}"`):''}`;
  }
  if (!a)
    return `<div class="notice neutral">${icon("file")}<span>本记录没有结构化工程验收结论。可以查看工具执行时间线与证据详情。</span></div>${r.messages?.length ? `<div class="section-heading"><h2>Agent 会话记录</h2></div>${r.messages.map((m) => `<article class="message"><span class="avatar">${icon("chat")}</span><div><div class="message-meta"><strong>${esc(m.role)}</strong></div><p class="message-text">${esc(m.text)}</p></div></article>`).join("")}` : ""}`;
  return `${a.status === "review_required" ? `<div class="notice">${icon("warning")}<span>有验收领域需要人工审查。请检查警告及其适用条件，再决定是否接受工程结果。</span></div>` : ""}<div class="section-heading"><h2>${w.recorded_acceptance_integrity ? "当时记录的验收结论" : "工程目标验收"}</h2>${w.recorded_acceptance_integrity ? "<small>原始结果已通过保存指纹核对</small>" : ""}</div><div class="domain-grid">${(
    a.domains || []
  )
    .filter((d) => !["not_requested", "not_evaluated"].includes(d.status))
    .map(
      (d) =>
        `<article class="domain ${esc(d.status)}"><div class="row"><h3>${esc(domainNames[d.domain] || d.domain)}</h3>${badge(d.status)}</div><p>${esc(domainDetail(d))}</p></article>`,
    )
    .join("")}</div>${
    (a.domains || []).some((d) =>
      ["not_requested", "not_evaluated"].includes(d.status),
    )
      ? `<details class="omitted-domains"><summary>本次未要求 ${(a.domains || []).filter((d) => ["not_requested", "not_evaluated"].includes(d.status)).length} 个领域</summary><p>${esc(
          (a.domains || [])
            .filter((d) =>
              ["not_requested", "not_evaluated"].includes(d.status),
            )
            .map((d) => domainNames[d.domain] || d.domain)
            .join("、"),
        )}</p></details>`
      : ""
  }<p class="meta">${a.profile === "fpga_ooc" ? "固定器件的 OOC 实现验收；CDC 仅在任务要求时检查。形式证明与板卡实测尚未评估。" : esc(a.scope || "功能、实现、CDC 与证据分别验收。形式证明和板卡实测需独立证据。")}</p>${w.recovery?.stalled ? `<div class="notice">${icon("warning")}同一失败已重复三次，请先诊断再创建新任务。</div>` : ""}`;
}
function runEvidence() {
  const r = state.run,
    w = r.workflow;
  openDrawer(
    "运行证据与恢复",
    `<h3>运行身份</h3><p><code>${esc(r.id)}</code></p><dl class="definition-list"><dt>证据完整性</dt><dd>${r.inspection?.valid ? "检查通过" : "需复核"}</dd><dt>当前可复用</dt><dd>${w?.valid === true ? "来源核验通过" : w?.valid === false ? "来源已变化或有缺失" : "未评估"}</dd><dt>工程目标</dt><dd>${badge(acceptanceFor(w)?.status || "unknown")}</dd></dl>${w ? `<h3>任务恢复</h3><div id="recovery-result">${button("recovery-check", "检查恢复条件", "refresh", `data-id="${esc(r.id)}"`)}</div>` : ""}<h3>待处理事项</h3><p>${esc([...(w?.issues || []), ...(r.inspection?.validation_issues || [])].join("\n") || "没有发现额外的文件完整性问题。")}</p><h3>报告与文件</h3><div id="artifact-list">${(r.artifacts || []).length ? (r.artifacts || []).map((f) => `<button class="evidence-link artifact-button" ${f.previewable === false ? 'disabled title="文件超过预览限制，请在本机查看"' : ""} data-action="artifact-preview" data-run="${esc(r.id)}" data-file="${esc(f.file)}">${icon("file")}<span>${esc(f.file)}<small class="meta">${(f.size_bytes / 1024).toFixed(1)} KB${f.previewable === false ? " · 超出预览范围，请在本机查看" : ""}</small></span>${icon("right")}</button>`).join("") : '<p class="meta">此运行暂无可预览文件。</p>'}</div><h3>领域证据</h3>${
      (acceptanceFor(w)?.domains || [])
        .filter((d) => d.evidence)
        .map(
          (d) =>
            `<button class="evidence-link artifact-button" data-action="artifact-preview" data-run="${esc(r.id)}" data-file="${esc(basename(d.evidence.result || d.evidence.file))}" ${d.evidence.result || d.evidence.file ? "" : "disabled"}>${icon("file")}<span>${esc(domainNames[d.domain] || d.domain)}<small class="meta">${esc(basename(d.evidence.result || d.evidence.file) || "证据文件未记录")}${d.evidence.sha256 ? " · " + esc(d.evidence.sha256.slice(0, 12)) : ""}</small></span>${icon("right")}</button>`,
        )
        .join("") || '<p class="meta">该记录未提供领域级证据链接。</p>'
    }<details class="tool-contract"><summary>查看完整检查结果</summary><pre>${esc(JSON.stringify({ inspection: r.inspection, recovery: w?.recovery }, null, 2))}</pre></details><p class="technical-note">历史结果只说明当时保存的证据；恢复操作必须重新检查输入、代码与任务所有者。</p>`,
    { wide: true },
  );
}
const fileKindNames = {
  rtl: "RTL 源码",
  testbench: "测试平台",
  constraint: "时钟与约束",
  metadata: "工程配置",
  script: "脚本",
  firmware: "固件",
  documentation: "说明",
  analog: "模拟电路",
  test_data: "测试数据",
};
const evidenceScopeNames = {
  unknown: "尚无领域证据",
  historical: "记录时的结果",
  current: "当前输入一致",
  aggregate_not_project_specific: "多项目聚合记录",
};

async function loadProjects() {
  const version = state.routeVersion;
  const value = await api("projects");
  if (version !== state.routeVersion) return;
  state.projects = value;
  renderProjects();
}
function renderProjects() {
  renderHeader(
    "工程",
    "本地源文件与关联证据",
    button("refresh", "刷新", "refresh"),
  );
  $("#content").innerHTML =
    `<div class="page engineering-page"><div class="toolbar"><label class="search-box">${icon("search")}<input id="project-search" aria-label="搜索工程" placeholder="搜索工程名称或目录" value="${esc(state.projectQuery)}"></label><select id="project-filter" aria-label="工程证据筛选"><option value="implemented">有实现文件</option><option value="all">所有工程</option><option value="current_evidence">当前证据</option><option value="historical">历史证据</option><option value="unknown">尚待验证</option><option value="metadata_only">仅项目说明</option></select></div><div id="project-list"></div></div>`;
  $("#project-filter").value = state.projectFilter;
  renderProjectList();
}
function renderProjectList() {
  const rows = (state.projects?.projects || []).filter(
    (p) =>
      `${p.title} ${p.publicPath}`
        .toLowerCase()
        .includes(state.projectQuery.toLowerCase()) &&
      (state.projectFilter === "all" ||
        (state.projectFilter === "implemented" &&
          p.implementation === "sources_present") ||
        p.verification === state.projectFilter ||
        p.implementation === state.projectFilter),
  );
  $("#project-list").innerHTML = rows.length
    ? `<div class="table-wrap project-table"><table><thead><tr><th>工程与目录</th><th>RTL / 声明</th><th>测试 / 约束</th><th>证据状态</th><th>最近更新</th></tr></thead><tbody>${rows.map((p) => `<tr><td><button class="project-open" data-action="project-open" data-id="${esc(p.id)}">${icon("chip")}<span><strong>${esc(p.title)}</strong><small>${esc(p.publicPath)}</small></span>${icon("right")}</button></td><td class="numeric">${p.counts?.rtl || 0} / ${p.counts?.rtl_modules ?? p.counts?.modules ?? 0}</td><td class="numeric">${p.counts?.testbench || 0} / ${p.counts?.constraint || 0}</td><td>${badge(p.verification)}${p.implementation === "metadata_only" ? '<small class="project-meta">仅项目说明</small>' : ""}</td><td class="meta">${date(p.last_modified)}</td></tr>`).join("")}</tbody></table></div><p class="pagination-note">显示 ${rows.length} / ${state.projects.projects.length} 个工程</p>`
    : empty("没有匹配的工程", "调整名称或证据筛选后重试。", "folder");
}
async function loadProject(id) {
  const version = state.routeVersion;
  const [project, changes] = await Promise.all([
    api("project?id=" + encodeURIComponent(id)),
    api("changes?project_id=" + encodeURIComponent(id)),
  ]);
  if (version !== state.routeVersion || state.id !== id) return;
  state.project = project;
  state.changes = changes.changes || [];
  state.projectSource = null;
  state.projectFileQuery = "";
  state.projectFileFilter = "all";
  renderProject();
  const top = project.workflows.find((w) => w.top)?.top;
  const first =
    project.files.find((f) => f.modules?.some((m) => m.name === top)) ||
    project.files.find((f) => f.editable) ||
    project.files[0];
  if (first) await openProjectSource(first.path);
}
function selectedProjectRanges() {
  if (!state.projectSelections.has(state.id))
    state.projectSelections.set(state.id, new Map());
  return state.projectSelections.get(state.id);
}
function projectMatrix() {
  const matrix = state.project.verification_matrix || {};
  const values = ["functional", "synthesis", "setup", "hold", "routing", "drc"];
  return `<section class="project-reports"><h2>关联工程证据</h2><table class="report-table"><tbody>${values
    .map((name) => {
      const value = matrix[name] || { status: "unknown", scope: "unknown" };
      const observed =
        name === "setup" && typeof value.observed === "number"
          ? `WNS ${value.observed} ns`
          : name === "hold" && typeof value.observed === "number"
            ? `WHS ${value.observed} ns`
            : name === "drc" &&
                typeof value.observed === "object" &&
                value.observed
              ? `${value.observed.errors ?? "?"} error / ${value.observed.warnings ?? "?"} warning`
              : "";
      return `<tr><th>${esc(domainNames[name])}<small>${esc(value.scope === "historical" ? "历史" : value.scope === "current" ? "输入一致" : "无证据")}</small></th><td>${value.run_id ? `<button data-action="project-report" data-domain="${esc(name)}" title="查看关联工程报告">${badge(value.status)}</button>` : badge(value.status)}${observed ? `<small>${esc(observed)}</small>` : ""}</td></tr>`;
    })
    .join(
      "",
    )}</tbody></table><details class="other-domains"><summary>CDC · 形式验证 · 板卡实测</summary>${["cdc", "formal", "hardware"].map((n) => `<div><span>${esc({ cdc: "CDC", formal: "形式验证", hardware: "板卡实测" }[n])}</span>${badge(matrix[n]?.status || "unknown")}</div>`).join("")}</details></section>`;
}
function renderProject() {
  const p = state.project,
    w = p.workflows.find((w) => w.top) || p.workflows[0] || {};
  const facts = [
    w.top ? `Top ${w.top}` : "",
    w.part,
    w.clock ? `${w.clock}${w.period_ns ? ` · ${w.period_ns} ns` : ""}` : "",
  ]
    .filter(Boolean)
    .join("  /  ");
  renderHeader(
    p.title,
    facts || p.publicPath,
    button("navigate", "切换工程", "folder", 'data-view="projects"'),
  );
  $("#content").className = "content project-content";
  $("#content").innerHTML =
    `<div class="eda-workspace"><aside class="project-files"><div class="panel-heading"><h2>Sources</h2><small>${p.counts?.rtl_modules ?? p.counts?.modules ?? 0} RTL 声明</small></div><label class="source-search search-box">${icon("search")}<input id="project-file-search" aria-label="搜索文件或模块" placeholder="文件 / 模块"></label><select id="project-file-filter" aria-label="文件类型"><option value="all">所有源文件</option>${Object.entries(
      fileKindNames,
    )
      .filter(([key]) => p.files.some((f) => f.kind === key))
      .map(([key, title]) => `<option value="${key}">${title}</option>`)
      .join(
        "",
      )}</select><div id="project-file-list"></div></aside><section class="project-code"><div id="project-source"></div></section><aside class="project-inspector">${projectMatrix()}<section class="scope-selection"><div class="panel-heading"><h2>修改范围</h2></div><div id="scope-selection"></div></section><section class="project-history"><div class="panel-heading"><h2>修改草案</h2></div><div id="project-changes">${projectChangesHtml()}</div></section><details class="project-protection"><summary>${icon("shield")} 保护文件与依赖</summary><div class="protected-files">${
      p.files
        .filter(
          (f) =>
            (f.editable === false &&
              ["testbench", "constraint", "test_data"].includes(f.kind)) ||
            f.dependency,
        )
        .map(
          (f) =>
            `<span><code>${esc(f.path)}</code><small>${esc(f.dependency ? "只读依赖" : fileKindNames[f.kind])}</small></span>`,
        )
        .join("") || '<span class="meta">未收录</span>'
    }</div></details></aside></div>`;
  renderProjectFiles();
  renderScopeSelection();
}
function renderProjectFiles() {
  const selected = state.projectSource?.path;
  const files = state.project.files.filter(
    (f) =>
      (state.projectFileFilter === "all" ||
        f.kind === state.projectFileFilter) &&
      `${f.path} ${(f.modules || []).map((m) => m.name).join(" ")}`
        .toLowerCase()
        .includes(state.projectFileQuery.toLowerCase()),
  );
  const groups = [
    { name: "Design", test: (f) => f.kind === "rtl" && !f.dependency },
    {
      name: "Simulation",
      test: (f) => ["testbench", "test_data"].includes(f.kind) && !f.dependency,
    },
    {
      name: "Constraints",
      test: (f) => f.kind === "constraint",
    },
    {
      name: "Dependencies",
      test: (f) => f.dependency && f.kind !== "constraint",
    },
    {
      name: "Other",
      test: (f) =>
        !["rtl", "testbench", "test_data", "constraint"].includes(f.kind) &&
        !f.dependency,
    },
  ];
  $("#project-file-list").innerHTML =
    groups
      .map((group) => {
        const entries = files.filter(group.test);
        return entries.length
          ? `<details class="source-group" ${["Design", "Simulation", "Constraints"].includes(group.name) || state.projectFileQuery ? "open" : ""}><summary>${icon("folder")}${group.name}<small>${entries.length}</small></summary>${entries.map((f) => `<div class="source-entry"><button class="project-file ${selected === f.path ? "active" : ""}" data-action="project-source" data-path="${esc(f.path)}" title="${esc(f.path)}" aria-label="打开 ${esc(f.path)}"><span>${icon(f.editable ? "file" : "shield")}<strong>${esc(basename(f.path))}</strong></span></button>${selected === f.path ? (f.modules || []).map((m) => `<button class="module-link" data-action="project-module" data-path="${esc(f.path)}" data-line="${m.line}">${icon("chip")}${esc(m.name)}<small>:${m.line}</small></button>`).join("") : ""}</div>`).join("")}</details>`
          : "";
      })
      .join("") || '<p class="empty-result">没有匹配文件。</p>';
}
async function openProjectSource(file, start = 1, count = 160) {
  const version = state.routeVersion,
    request = ++state.projectSourceVersion,
    projectId = state.id;
  const target = state.project.files.find((f) => f.path === file);
  if (!target) throw new Error("请从当前工程中选择文件。");
  $("#project-source").innerHTML =
    '<div class="loading-state">正在读取源文件…</div>';
  try {
    const source = await api(
      `project-source?id=${encodeURIComponent(projectId)}&path=${encodeURIComponent(file)}&start_line=${start}&line_count=${count}`,
    );
    if (
      version !== state.routeVersion ||
      request !== state.projectSourceVersion ||
      projectId !== state.id
    )
      return;
    state.projectSource = { ...source, path: file, file: target };
    renderProjectSource();
    renderProjectFiles();
  } catch (error) {
    if (
      version === state.routeVersion &&
      request === state.projectSourceVersion
    )
      $("#project-source").innerHTML =
        `<div class="source-error"><h3>暂时无法预览这个文件</h3><p>${esc(error.message)}</p></div>`;
  }
}
function highlightRtl(line) {
  const tokens =
    /(\/\/.*|"(?:\\.|[^"\\])*"|\b(?:module|endmodule|input|output|inout|wire|reg|logic|parameter|localparam|assign|always|always_ff|always_comb|begin|end|if|else|case|endcase|default|posedge|negedge|generate|endgenerate|genvar|for|integer|function|endfunction|task|endtask|initial|typedef|enum)\b|\b\d+(?:'[bBhHdD][0-9a-fA-F_xXzZ]+)?\b)/g;
  let result = "",
    last = 0;
  for (const match of line.matchAll(tokens)) {
    const token = match[0],
      kind = token.startsWith("//")
        ? "comment"
        : token.startsWith('"')
          ? "string"
          : /^\d/.test(token)
            ? "number"
            : "keyword";
    result +=
      esc(line.slice(last, match.index)) +
      `<span class="rtl-${kind}">${esc(token)}</span>`;
    last = match.index + token.length;
  }
  return result + esc(line.slice(last));
}
async function projectReport(domain) {
  const project = state.project,
    value = project?.verification_matrix?.[domain],
    version = state.routeVersion;
  if (!value?.run_id) return;
  const evidence = value.evidence || {},
    file = basename(evidence.result || evidence.file || ""),
    child = basename(evidence.child_directory || "");
  const report = file
    ? await api(
        "artifact?run_id=" +
          encodeURIComponent(value.run_id) +
          "&file=" +
          encodeURIComponent(file),
      )
    : null;
  let readable = null;
  if (child) {
    const listing = await api("artifacts?run_id=" + encodeURIComponent(child));
    const pattern =
      domain === "drc"
        ? /drc.*\.rpt$/i
        : ["setup", "hold"].includes(domain)
          ? /timing.*\.rpt$/i
          : domain === "synthesis"
            ? /utilization.*\.rpt$/i
            : null;
    const match = pattern
      ? listing.files?.find(
          (f) => f.previewable !== false && pattern.test(f.file),
        )
      : null;
    if (match)
      readable = await api(
        "artifact?run_id=" +
          encodeURIComponent(child) +
          "&file=" +
          encodeURIComponent(match.file),
      );
  }
  if (version !== state.routeVersion || project.id !== state.project?.id)
    return;
  const observed =
    typeof value.observed === "object"
      ? Object.entries(value.observed || {})
          .map(
            ([k, v]) =>
              `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`,
          )
          .join(" · ")
      : String(value.observed ?? "未记录");
  openDrawer(
    domainNames[domain] || domain,
    `<div class="row wrap">${badge(value.status)}<span class="meta">${esc(evidenceScopeNames[value.scope] || value.scope)}</span></div><p class="report-observed">${esc(observed)}${["setup", "hold"].includes(domain) ? " ns" : ""}</p><p class="technical-note">${esc(project.title)} · 关联工程运行</p>${readable ? `<h3>${esc(readable.file)}</h3><pre class="eda-report-text">${esc(readable.text)}</pre>` : ""}${report ? `<details class="tool-contract"><summary>原始回执 · ${esc(report.file)}</summary><pre>${esc(report.text)}</pre><p class="technical-note">SHA-256 ${esc(report.sha256)}</p></details>` : ""}${button("open-run", "打开运行详情", "runs", `data-id="${esc(value.run_id)}"`)}`,
    { wide: true },
  );
}
function renderProjectSource() {
  const source = state.projectSource,
    file = source.file,
    selected = selectedProjectRanges().get(source.path),
    start = selected?.start_line || source.start_line,
    end = selected?.end_line || start;
  $("#project-source").innerHTML =
    `<div class="source-header"><span>${icon("file")}<strong>${esc(basename(source.path))}</strong><small>${file.editable ? "RTL" : "只读"}</small></span><small>${source.total_lines} 行</small></div><div class="source-range"><label>行 <input id="source-start" type="number" min="1" max="${source.total_lines}" value="${start}" aria-label="修改起始行"></label><span>—</span><input id="source-end" type="number" min="1" max="${source.total_lines}" value="${end}" aria-label="修改结束行">${button("source-range-load", "定位", "search", "", "subtle")}${button("scope-add", "限定修改", "plus", file.editable && !state.project.truncated ? "" : "disabled")}</div><div class="source-lines" role="region" aria-label="${esc(basename(source.path))} 源码" tabindex="0">${source.lines.map((row) => `<div class="source-line ${row.number >= start && row.number <= end ? "selected" : ""}" data-line="${row.number}"><button data-action="source-line" data-line="${row.number}" aria-label="选择第 ${row.number} 行">${row.number}</button><code>${highlightRtl(row.text)}</code></div>`).join("")}</div><div class="source-footer"><span>Ln ${source.start_line}–${source.end_line} / ${source.total_lines}</span>${source.end_line < source.total_lines ? button("source-next", "下一段", "right", `data-start="${source.end_line + 1}"`, "subtle") : ""}<small title="${esc(source.sha256)}">SHA ${esc(source.sha256.slice(0, 10))}</small><span class="source-hint">Shift + 点击连续选行</span></div>${(file.evidence_links || []).length ? `<div class="file-evidence">参与 ${file.evidence_links.length} 次关联工程验收 · 不代表模块独立证明</div>` : ""}`;
}
function sourceRange() {
  const start = Number($("#source-start")?.value),
    end = Number($("#source-end")?.value);
  if (
    !Number.isSafeInteger(start) ||
    !Number.isSafeInteger(end) ||
    start < 1 ||
    end < start ||
    end > state.projectSource.total_lines ||
    end - start + 1 > 400
  )
    throw new Error("请选择文件内连续的 1 至 400 行，结束行不能早于起始行。");
  return {
    path: state.projectSource.path,
    start_line: start,
    end_line: end,
    sha256: state.projectSource.sha256,
  };
}
function addScopeRange() {
  if (!state.projectSource.file.editable)
    throw new Error("测试、约束与依赖文件为只读，不能加入修改范围。");
  const range = sourceRange(),
    selected = selectedProjectRanges();
  if (!selected.has(range.path) && selected.size >= 8)
    throw new Error("一个修改草案最多选择 8 个文件。");
  selected.set(range.path, range);
  renderScopeSelection();
  toast("已加入限定范围；原始文件保持不变。");
}
function renderScopeSelection() {
  const selection = [...selectedProjectRanges().values()];
  $("#scope-selection").innerHTML = selection.length
    ? `<div class="scope-items">${selection.map((r) => `<div><span>${icon("file")}<code>${esc(r.path)}</code><small>第 ${r.start_line}–${r.end_line} 行</small></span>${iconButton("scope-remove", "移除范围", "close", `data-path="${esc(r.path)}"`)}</div>`).join("")}</div><div class="scope-actions"><p>${selection.length} 个文件，${selection.reduce((n, r) => n + r.end_line - r.start_line + 1, 0)} 行。测试与约束保持受保护。</p>${button("change-plan", "创建修改草案", "file", "", "primary")}</div>`
    : '<div class="scope-empty">选定 RTL 行后点击“限定修改”。</div>';
}
function projectChangesHtml() {
  return state.changes.length
    ? `<div class="change-list">${state.changes.map((c) => `<button class="change-row" data-action="change-open" data-id="${esc(c.id)}"><span>${icon("file")}<strong>${esc(c.goal || "工程修改草案")}</strong><small>${date(c.created_at)}</small></span>${badge(c.status)}${icon("right")}</button>`).join("")}</div>`
    : '<p class="meta">暂无草案</p>';
}
function newChangeDrawer() {
  const selections = [...selectedProjectRanges().values()];
  if (!selections.length)
    throw new Error("请先选择至少一个 RTL 文件的连续行范围。");
  openDrawer(
    "创建限定范围的修改草案",
    `<p>说明目标后保存范围。下一步编辑替换内容并审阅差异。</p><form id="change-plan-form" class="form-grid"><label>修改目标<textarea id="change-goal" required maxlength="2048" rows="4" placeholder="例如：为这个状态机补充默认分支，保留接口与时序约束。"></textarea></label><div class="scope-items">${selections.map((s) => `<div><code>${esc(s.path)}</code><span>第 ${s.start_line}–${s.end_line} 行</span></div>`).join("")}</div><label>关联工作会话<select id="change-session"><option value="">仅保存工程草案</option>${state.overview.sessions
      .filter((s) => !s.archived)
      .map((s) => `<option value="${esc(s.id)}">${esc(s.title)}</option>`)
      .join(
        "",
      )}</select></label><button type="submit" class="button primary">保存范围并编辑内容</button></form><p class="technical-note">此步骤只保存草案与输入指纹。模型 API 保持停用。</p>`,
    { wide: true },
  );
}
async function openChange(id) {
  const change = await api("change?id=" + encodeURIComponent(id));
  state.change = change;
  renderChangeDrawer(change);
}
function renderChangeDrawer(change) {
  state.change = change;
  const done = change.status === "candidate_created",
    previewed = change.status === "previewed";
  const checks = change.checks
    ? `<div class="change-checks">${Object.entries(change.checks)
        .map(
          ([name, value]) =>
            `<span>${icon(value === true ? "check" : "warning")}${esc({ scope: "修改范围", baseline: "原件指纹", protected: "保护文件" }[name] || name)} ${value === true ? "一致" : "需核对"}</span>`,
        )
        .join("")}</div>`
    : "";
  let body = `<div class="change-heading"><p>${esc(change.goal)}</p>${badge(change.status)}</div><div class="scope-summary">${change.scope.map((s) => `<span><code>${esc(s.path)}</code> 第 ${s.start_line}–${s.end_line} 行</span>`).join("")}</div>`;
  if (done)
    body += `<div class="notice neutral">${icon("shield")}<span>隔离源码候选已生成。依赖仍按工程清单引用；功能、时序与设计规则尚未验证。</span></div>${checks}<dl class="definition-list"><dt>候选目录</dt><dd><code>${esc(change.candidate?.directory || "未记录")}</code></dd><dt>工程验证</dt><dd>${badge(change.validation?.status || "not_run")}</dd><dt>原件状态</dt><dd>${change.baseline_current === false ? "原件已有变化，需重新核对" : change.baseline_current === true ? "当前原件指纹一致" : "生成时已核对，当前状态可重新检查"}</dd></dl>${change.candidate_integrity !== undefined ? `<p class="candidate-integrity">${icon(change.candidate_integrity ? "check" : "warning")}候选文件完整性：${change.candidate_integrity ? "核验一致" : "存在差异，需复核"}</p>` : ""}${button("change-check", "核对候选与原件", "shield", `data-id="${esc(change.id)}"`)}`;
  else if (previewed)
    body += `${checks}<p class="meta">审阅以下差异后，生成隔离源码候选。源工程与保护文件保持原样，依赖按工程清单引用。</p>${change.diff.map((d) => `<section class="change-diff"><h3>${esc(d.path)} <small>−${d.removed_lines} / +${d.added_lines} 行</small></h3><div class="diff-columns"><div><span>原范围</span><pre class="diff-before">${esc(d.before)}</pre></div><div><span>替换内容</span><pre class="diff-after">${esc(d.after)}</pre></div></div></section>`).join("")}<div class="change-actions">${button("change-edit", "继续编辑", "file")}${button("change-apply", "生成修改候选", "check", `data-id="${esc(change.id)}"`, "primary")}</div><p class="technical-note">仅此按钮会写入隔离候选。当前工程验证状态：未执行。</p>`;
  else
    body += `<form id="change-preview-form" class="change-edit-form">${change.scope.map((s, i) => `<label class="replacement-editor"><span>${esc(s.path)} <small>第 ${s.start_line}–${s.end_line} 行</small></span><textarea data-edit-path="${esc(s.path)}" spellcheck="false" maxlength="16384" rows="${Math.min(16, Math.max(6, s.end_line - s.start_line + 3))}" aria-label="${esc(s.path)} 替换内容">${esc(change.diff?.find((d) => d.path === s.path)?.after ?? s.before)}</textarea></label>`).join("")}<button type="submit" class="button primary">预览修改差异</button></form><p class="technical-note">每个文件最多 16 KiB 替换内容。需产生真实修改，才能进入候选生成步骤。</p>`;
  body += `<details class="protected-details"><summary>${icon("shield")} ${change.protected_files.length} 份受保护文件</summary><div class="protected-files">${change.protected_files.map((f) => `<span><code>${esc(f.path)}</code><small>${esc(fileKindNames[f.kind] || f.kind)}</small></span>`).join("") || "<p>当前项目未收录保护文件。</p>"}</div></details>`;
  openDrawer(
    done ? "修改候选" : previewed ? "审阅修改差异" : "编辑限定范围",
    body,
    { wide: true },
  );
}
async function refreshProjectChanges() {
  if (state.view !== "projects" || !state.project) return;
  const id = state.id,
    version = state.routeVersion,
    data = await api("changes?project_id=" + encodeURIComponent(id));
  if (version !== state.routeVersion || id !== state.id) return;
  state.changes = data.changes || [];
  if ($("#project-changes"))
    $("#project-changes").innerHTML = projectChangesHtml();
}

async function loadEvaluations() {
  const version = state.routeVersion;
  const [data, testing] = await Promise.all([
    api("evaluations"),
    api("testing"),
  ]);
  if (version !== state.routeVersion) return;
  state.evaluations = data;
  state.testing = testing;
  renderEvaluations();
}
function renderEvaluations() {
  renderHeader(
    "Test Explorer",
    "保留回执 · 分类分母独立",
    button("evaluation-launcher", "运行评测", "play") +
      button("refresh", "刷新", "refresh"),
  );
  $("#content").className = "content";
  const lanes = (
    state.testing?.lanes || [
      { id: "software", title: "软件机制" },
      { id: "retrieval", title: "RAG 检索" },
      { id: "tool_execution", title: "工具测试" },
      { id: "engineering", title: "工程验收" },
      { id: "online_agent", title: "Agent 任务" },
    ]
  ).map((l) => [l.id, l.title]);
  lanes.push(["history", "历史成绩"]);
  if (!lanes.some(([id]) => id === state.evalLane)) state.evalLane = "software";
  $("#content").innerHTML =
    `<div class="page engineering-page"><div class="tabs testing-tabs" role="tablist" aria-label="评测分类">${lanes.map(([id, label]) => `<button role="tab" aria-selected="${state.evalLane === id}" data-action="eval-tab" data-tab="${id}" class="${state.evalLane === id ? "active" : ""}">${esc(label)}</button>`).join("")}</div><div id="active-jobs">${busyJobsHtml()}</div>${state.evalLane === "history" ? historyHtml() : testingLaneHtml()}</div>`;
  if (state.evalLane !== "history" && state.testing) {
    for (const key of ["category", "tier", "family", "status"])
      if ($("#testing-" + key))
        $("#testing-" + key).value = state.testingFilters[key];
    renderTestingCases();
  }
}
function testingLane() {
  return state.testing?.lanes.find((l) => l.id === state.evalLane);
}
function testingLaneHtml() {
  const lane = testingLane();
  if (!lane) return '<div class="loading-state">正在读取分类与逐项证据…</div>';
  const cases = lane.groups.flatMap((g) => g.cases),
    summary = lane.summary || {},
    filters = state.testingFilters;
  const options = (key) =>
    [...new Set(cases.map((c) => c[key]).filter(Boolean))]
      .sort()
      .map(
        (value) =>
          `<option value="${esc(value)}">${esc(key === "tier" ? tierNames[value] || value : categoryLabel(value))}</option>`,
      )
      .join("");
  const statusOptions = [
    ...new Set(cases.map((c) => c.status).filter(Boolean)),
  ].sort();
  const stats = [
    ["total", "本类分母"],
    ["passed", "通过"],
    ["failed", "失败"],
    ["not_run", "未执行"],
    ["unknown", "待核验"],
    ["blocked", "缺少前提"],
    ["review_required", "需审查"],
    ["expected_failure", "预期失败"],
    ["expected_timeout", "预期超时"],
  ].filter(
    ([key]) =>
      key === "total" ||
      key === "passed" ||
      key === "failed" ||
      key === "not_run" ||
      summary[key],
  );
  const scopeNote =
    {
      tool_execution: "最近保留结果；按案例定义关联工具回执，未复跑当前 RTL。",
      engineering: "保留的工程领域验收；输入变化会单独标注。",
      retrieval: "24 条可见检索问题与 3 条无关问题；不计作盲测答案分。",
      software: "保留的软件检查回执；源码变化不抹去历史记录。",
      online_agent: "每个会话与工程关联单独计数；重复评估保留在该任务的历史中。",
    }[state.evalLane] || "";
  const unbound = lane.unbound_history || [];
  const unboundHtml = unbound.length ? '<details class="tool-contract"><summary>未关联会话的评估：' + unbound.length + ' 条，不计入任务分母</summary><pre>' + esc(JSON.stringify(unbound, null, 2)) + '</pre></details>' : '';
  return unboundHtml + `<p class="testing-scope">${esc(scopeNote)}</p><div class="testing-summary">${stats.map(([key, title]) => `<div class="summary-${key}"><strong>${summary[key] ?? 0}</strong><span>${title}</span></div>`).join("")}<p>单位：${esc(unitNames[lane.unit] || lane.unit)}<br>只统计当前分类，不合并为总分</p></div>${lane.receipt?.current_sources_match === false ? '<div class="notice neutral">' + icon("clock") + "<span>当前显示保留回执；源码已经变化，请结合具体用例证据判断适用范围。</span></div>" : ""}<div class="testing-filters"><label class="search-box">${icon("search")}<input id="testing-query" aria-label="搜索测试用例" placeholder="搜索测试名称、工具或工程" value="${esc(filters.query)}"></label><label>类别<select id="testing-category"><option value="">全部类别</option>${options("category")}</select></label><label>层级<select id="testing-tier"><option value="">全部层级</option>${options("tier")}</select></label><label>工具族<select id="testing-family"><option value="">全部工具族</option>${options("family")}</select></label><label>状态<select id="testing-status"><option value="">全部状态</option>${statusOptions.map((s) => `<option value="${esc(s)}">${esc(statusNames[s] || s)}</option>`).join("")}</select></label></div><div id="testing-cases"></div>${(lane.aggregates || []).length ? `<section class="aggregate-receipts"><h3>Runner 汇总回执</h3>${lane.aggregates.map((a) => `<div><span>${esc(a.name)} <small>${a.recorded_test_count ?? "—"} 项${a.individual_results === 0 ? "，未保存逐项结果" : ""}</small></span>${badge(a.status)}</div>`).join("")}<p>汇总数量与可展开的逐项用例分别保留。</p></section>` : ""}`;
}
function renderTestingCases() {
  const lane = testingLane();
  if (!lane || !$("#testing-cases")) return;
  const filters = state.testingFilters,
    total = lane.groups.reduce((n, g) => n + g.cases.length, 0);
  let visible = 0;
  const groups = lane.groups
    .map((group) => {
      const cases = group.cases.filter(
        (c) =>
          ["category", "tier", "family", "status"].every(
            (key) => !filters[key] || c[key] === filters[key],
          ) &&
          `${c.title} ${c.id} ${c.tool || ""} ${c.project || ""}`
            .toLowerCase()
            .includes(filters.query.toLowerCase()),
      );
      visible += cases.length;
      return cases.length
        ? `<section class="testing-group"><div class="section-heading"><h2>${esc(categoryLabel(group.title))}</h2><small>${cases.length} 项</small></div><div class="testing-case-list">${cases
            .map(
              (c) =>
                `<button class="testing-case" data-action="testing-case" data-id="${esc(c.id)}" data-group="${esc(group.id)}"><span class="testing-case-main"><strong>${esc(c.title)}</strong><span class="case-tags">${[
                  c.category,
                  c.tier,
                  c.family,
                ]
                  .filter(Boolean)
                  .map((tag) => `<small>${esc(categoryLabel(tag))}</small>`)
                  .join(
                    "",
                  )}${c.latest?.current_sources_match === false ? '<small class="historical-label">源码已变化</small>' : ""}${c.latest?.current_definition_match === false ? '<small class="historical-label">定义已变化</small>' : ""}${c.latest?.current_inputs?.current_sources_match === false ? '<small class="historical-label">输入已变化</small>' : ""}</span></span><span class="case-evidence">${c.latest ? date(c.latest.started_at) : "尚无执行回执"}${c.history_count > 1 ? `<small>${c.history_count} 次历史记录</small>` : ""}</span>${badge(c.status)}${icon("right")}</button>`,
            )
            .join("")}</div></section>`
        : "";
    })
    .join("");
  $("#testing-cases").innerHTML =
    `<p class="testing-filter-count">当前显示 ${visible} / ${total} 个可展开用例</p>` +
    (groups ||
      empty("没有匹配的测试", "调整搜索词、层级或状态筛选。", "search"));
}
function testingCaseDetail(groupId, id) {
  const group = testingLane()?.groups.find((g) => g.id === groupId),
    item = group?.cases.find((c) => c.id === id);
  if (!item) throw new Error("测试记录已经变化，请刷新后重试。");
  const evidence = item.latest?.evidence || item.evidence || [];
  const rows = Array.isArray(evidence) ? evidence : [evidence];
  const warnings = [
    item.latest?.current_definition_match === false ? "用例定义已经变化" : "",
    item.latest?.receipt_integrity === false ? "回执完整性未通过" : "",
    item.latest?.current_inputs?.current_sources_match === false
      ? "输入源码已变化"
      : "",
    item.latest?.current_sources_match === false ? "本轮源码与记录时不同" : "",
  ].filter(Boolean);

  openDrawer(
    item.title,
    `<div class="row wrap">${badge(item.status)}<span class="meta">${esc(categoryLabel(group.title))}</span></div><dl class="definition-list"><dt>计分单位</dt><dd>${esc(unitNames[item.unit] || item.unit || testingLane().unit)}</dd><dt>类别 / 层级</dt><dd>${esc(categoryLabel(item.category) || "未分类")} / ${esc(tierNames[item.tier] || item.tier || "未记录")}</dd><dt>工具族</dt><dd>${esc(item.family || item.tool || "未记录")}</dd><dt>最近执行</dt><dd>${item.latest ? date(item.latest.started_at) : "未发现执行回执"}</dd>${item.latest?.reason ? `<dt>执行说明</dt><dd>${esc(item.latest.reason)}</dd>` : ""}${item.latest?.raw_status ? `<dt>原始状态</dt><dd>${esc(item.latest.raw_status)}</dd>` : ""}${Number.isFinite(item.latest?.duration_ms) ? `<dt>耗时</dt><dd>${(item.latest.duration_ms / 1000).toFixed(2)} s</dd>` : ""}</dl>${item.status === "not_run" ? '<div class="notice neutral">' + icon("clock") + "<span>目录中存在此测试定义，尚未发现对应执行证据。</span></div>" : ""}${["expected_failure", "expected_timeout"].includes(item.status) ? '<div class="notice neutral">' + icon("warning") + "<span>这是预期失败或超时场景的记录，不计作设计功能通过。</span></div>" : ""}${warnings.length ? `<div class="notice neutral">${icon("warning")}<span>${esc(warnings.join("；"))}。此处保留原始执行记录。</span></div>` : ""}<h3>证据来源</h3>${rows.length ? rows.map((e) => `<div class="evidence-link">${icon("file")}<span><code>${esc(typeof e === "string" ? e : e.path || e.file || JSON.stringify(e))}</code>${e.sha256 ? `<details class="evidence-hash"><summary>SHA-256 指纹</summary><code>${esc(e.sha256)}</code></details>` : ""}</span></div>`).join("") : '<p class="meta">没有可定位的证据文件。</p>'}<h3>保留的执行历史</h3>${(item.history || []).length ? `<div class="case-history">${item.history.map((h) => `<div><span>${date(h.started_at)}<small>${esc(h.id || h.run_id || "")}</small></span>${badge(h.status)}</div>`).join("")}</div>` : '<p class="meta">尚无执行历史。</p>'}${item.history_count > (item.history || []).length ? `<p class="technical-note">共 ${item.history_count} 条历史，当前展示最近 ${(item.history || []).length} 条。</p>` : ""}<details class="tool-contract"><summary>查看检查字段与适用范围</summary><pre>${esc(JSON.stringify(item.latest || { status: item.status, source: item.source, scope: item.scope }, null, 2))}</pre></details>`,
    { wide: true },
  );
}
function evaluationLauncher() {
  openDrawer(
    "运行分类评测",
    `<p>选择套件后查看执行范围。真实 EDA 套件需要本机工具与固定输入。</p>${suitesHtml("all")}`,
    { wide: true },
  );
}
function freshnessText(receipt) {
  if (receipt?.freshness?.reason === "software_validation_sources_unbound")
    return "历史软件回执，未完整绑定本版本源码";
  const current = receipt?.freshness?.current_sources_match;
  return current === true
    ? "记录的协议源码一致"
    : current === false
      ? "源码已更新，作为历史记录查看"
      : "未记录完整源码指纹";
}
function softwareMetrics(receipt) {
  if(receipt.metrics?.categories) {
    const names={isolation:'候选隔离',guidance:'知识与 SOP',context:'长会话上下文',dispatch:'工具边界',integrity:'输入与证据',ownership:'并发占用',recovery:'任务恢复',budget:'累计预算',delivery:'工程交付'};
    return `<div class="scenario-metrics"><strong>模拟任务 ${receipt.metrics.passed} / ${receipt.metrics.total}</strong><div class="verifier-domains">${Object.entries(receipt.metrics.categories).map(([name,row])=>`<span>${esc(names[name]||name)} ${row.passed}/${row.total}</span>`).join('')}</div><span class="meta">假 EDA 与假生成器；不计为 RTL 或模型能力成绩</span></div>`;
  }
  return (receipt.metrics?.checks || [])
    .map(
      (c) =>
        `<span>${esc(c.name)} ${Number.isFinite(c.test_count) ? c.test_count : "—"} 项 ${c.passed ? "通过" : "未通过"}</span>`,
    )
    .join(" ");
}
function suitesHtml(lane = state.evalLane) {
  const data = state.evaluations;
  if (!data) return '<div class="loading-state">正在读取评测记录…</div>';
  const suites = data.suites.filter((s) => lane === "all" || s.lane === lane);
  return `<div class="suite-list">${suites
    .map((s) => {
      const receipt = data.receipts.find((r) => r.suite === s.id);
      const freshness = receipt?.freshness?.current_sources_match;
      return `<article class="suite-card"><div><div class="suite-title"><h3>${esc(suiteNames[s.id] || s.id)}</h3></div><p>${esc(suiteDescriptions[s.id] || s.description)}</p><div class="suite-meta"><span>计分单位：${esc(unitNames[s.unit] || s.unit)}</span><span>${s.launches_eda ? "使用本机 EDA 工具" : "模型调用为 0"}</span></div></div><div class="suite-actions">${receipt ? badge(receipt.status) : '<span class="badge">尚无回执</span>'}${button("evaluate", s.id === "online-agent" ? "核验已有会话" : s.launches_eda ? "准备 EDA 评测" : "运行离线评测", s.launches_eda ? "play" : "chart", `data-suite="${esc(s.id)}"`)}</div>${receipt ? `<div class="receipt-note"><span>最近一次 ${date(receipt.finished_at || receipt.started_at)}</span><span>${freshnessText(receipt)}</span>${receipt.metrics?.after ? `<span>Hit@5 ${receipt.metrics.after.hits}/${receipt.metrics.after.total}</span>` : ""}${softwareMetrics(receipt)}${receipt.workflow ? `<button class="text-button" data-action="open-run" data-id="${esc(basename(receipt.workflow))}">查看工程验收</button>` : `<button class="text-button" data-action="evaluation-detail" data-id="${esc(receipt.id)}">查看评测回执</button>`}</div>` : ""}</article>`;
    })
    .join(
      "",
    )}</div>${state.evalLane === "online_agent" ? `<div class="notice neutral">${icon("shield")}<span>当前模型 API 停用。这里核验已有真实会话及其工程子任务，评测器不会启动模型。</span></div>` : ""}`;
}
function historyHtml() {
  return `<div class="notice neutral">${icon("clock")}<span>以下是保留的历史功能记录。结果按原计分单位展示；历史成绩不代表当前代码已复测。</span></div><div class="section-heading"><h2>已归档功能成绩</h2><small>${state.overview.history.length} 组记录</small></div><div class="table-wrap"><table><thead><tr><th>功能与工程</th><th>记录结果</th><th>计分单位</th><th>证据</th></tr></thead><tbody>${state.overview.history.map((r) => `<tr><td>${esc(r.title)}<details><summary>验收范围</summary><p>${esc(Array.isArray(r.limitations) ? r.limitations.join("；") : r.limitations)}</p></details></td><td class="numeric">${r.passed !== undefined ? `${r.passed} / ${r.total}` : r.wns_gain_ns !== undefined ? `+${r.wns_gain_ns} ns` : "按原分类"}</td><td>${esc(r.unit)}</td><td>${r.evidence_count} 份</td></tr>`).join("")}</tbody></table></div>`;
}
async function previewArtifact(id, file, offset = 0) {
  const value = await api(
    "artifact?run_id=" +
      encodeURIComponent(id) +
      "&file=" +
      encodeURIComponent(file) +
      "&offset=" +
      offset,
  );
  openDrawer(
    basename(value.file) || "文件预览",
    `<div class="row wrap">${button("run-evidence", "返回证据", "back")}<span class="meta">${(value.total_bytes / 1024).toFixed(1)} KB${value.redacted ? " · 敏感内容已隐藏" : ""}</span></div><pre>${esc(value.text || "文件没有可显示文本。")}</pre>${value.next_offset != null && value.truncated ? button("artifact-next", "继续读取", "right", `data-run="${esc(id)}" data-file="${esc(file)}" data-offset="${value.next_offset}"`) : ""}<p class="technical-note">${esc(value.file)}<br>SHA-256 ${esc(value.sha256)}</p>`,
    { wide: true },
  );
}
async function checkRecovery(id) {
  const r = await api("recovery", { run_id: id, action: "check" });
  const holder = $("#recovery-result");
  if (!holder || state.run?.id !== id) return;
  holder.innerHTML = `<div class="notice ${r.ready ? "neutral" : ""}">${icon(r.ready ? "check" : "warning")}<span>${r.ready ? "恢复前提已核验。续跑会保存到新的运行目录。" : "当前不满足恢复条件。请处理下方问题后重新检查。"}</span></div><p class="technical-note">${esc((r.issues || []).join("；"))}</p>${r.ready ? button("recovery-resume", "从检查点继续", "play", `data-id="${esc(id)}"`, "primary") : ""}`;
}
async function resumeRecovery(id) {
  const owner = state.run?.id === id ? state.run.owner_session_id : null;
  const s = owner
    ? await api("session?id=" + encodeURIComponent(owner))
    : await ensureSession();
  if (s.archived || s.archived_at)
    throw new Error("请先从会话栏恢复该任务所属的归档会话。");
  const j = await api("recovery", {
    run_id: id,
    action: "resume",
    session_id: s.id,
  });
  closeDrawer();
  await refreshOverview();
  go("sessions", s.id);
  toast("已在新运行目录继续任务。");
  return j;
}
function evaluationDetail(id) {
  const r = state.evaluations.receipts.find((v) => v.id === id);
  if (!r) return;
  openDrawer(
    "评测回执",
    `<h3>${esc(suiteNames[r.suite] || r.suite)}</h3><dl class="definition-list"><dt>执行结果</dt><dd>${badge(r.status)}</dd><dt>计分单位</dt><dd>${esc(unitNames[r.unit] || r.unit)}</dd><dt>开始时间</dt><dd>${date(r.started_at)}</dd><dt>结束时间</dt><dd>${date(r.finished_at)}</dd><dt>来源状态</dt><dd>${freshnessText(r)}</dd><dt>模型调用</dt><dd>${r.provider_calls_by_evaluator ?? "未记录"}</dd></dl>${r.metrics?.after ? `<h3>检索结果</h3><p>Hit@5：${r.metrics.after.hits}/${r.metrics.after.total}<br>MRR：${Number(r.metrics.after.mrr).toFixed(3)}</p>` : ""}${softwareMetrics(r)}${r.reason ? `<div class="notice">${esc(r.reason)}</div>` : ""}<details class="tool-contract"><summary>完整回执与来源指纹</summary><pre>${esc(JSON.stringify(r, null, 2))}</pre></details>`,
  );
}
async function evaluate(suite) {
  if (suite === "online-agent") {
    openDrawer(
      "核验已有 Agent 会话",
      `<p>提供 artifacts 中已有的 Pi 会话与直接关联的工程工作流。会话输入、终态、因果关联和工程目标都会核验。</p><form id="agent-evaluation" class="form-grid"><label>Pi 会话目录<input id="agent-session" placeholder="artifacts/native-agent-…" required></label><label>工程工作流目录<input id="agent-workflow" placeholder="artifacts/…-eda_workflow_run-…" required></label><button class="button primary" type="submit">核验已有会话</button></form>`,
    );
    return;
  }
  if (suite.startsWith("online-")) {
    showDialog(
      "启动真实 EDA 评测",
      `<p>${esc(suiteDescriptions[suite])}。这会使用本机 EDA 工具并生成新运行目录。</p>`,
      [
        { label: "取消", action: () => {} },
        {
          label: "开始评测",
          primary: true,
          action: () => launchEvaluation(suite),
        },
      ],
    );
    return;
  }
  await launchEvaluation(suite);
}
async function launchEvaluation(suite, args = {}) {
  await api("evaluate", { suite, ...args });
  closeDrawer();
  await refreshOverview();
  if (state.view === "evaluations") renderEvaluations();
  toast("评测已启动，可在当前页面查看执行状态。");
}
function showDialog(title, body, actions) {
  const dialog = $("#dialog");
  dialog.innerHTML = `<h2>${esc(title)}</h2>${body}<div class="dialog-actions">${actions.map((a, i) => `<button class="button ${a.primary ? "primary" : ""} ${a.danger ? "danger" : ""}" data-dialog-index="${i}">${esc(a.label)}</button>`).join("")}</div>`;
  dialog.showModal();
  dialog.onclick = async (e) => {
    const button = e.target.closest("[data-dialog-index]");
    if (!button) return;
    const action = actions[Number(button.dataset.dialogIndex)];
    const value = $("#dialog input")?.value;
    const controls = [...dialog.querySelectorAll("button")];
    controls.forEach((control) => {
      control.disabled = true;
    });
    dialog.querySelector(".dialog-error")?.remove();
    try {
      await action.action(value);
      dialog.close();
    } catch (error) {
      const message = document.createElement("p");
      message.className = "dialog-error";
      message.setAttribute("role", "alert");
      message.textContent = error.message;
      dialog.querySelector(".dialog-actions").before(message);
      dialog.querySelector("input")?.focus();
    } finally {
      controls.forEach((control) => {
        control.disabled = false;
      });
    }
  };
}
function sessionMenu(id) {
  const s = state.overview.sessions.find((x) => x.id === id) || state.session;
  if (!s) return;
  showDialog(
    "会话设置",
    `<label for="session-title">会话名称</label><input id="session-title" value="${esc(s.title || "新会话")}" maxlength="120"><p>消息、任务和运行证据都保留在本地。归档后可从会话栏恢复。</p>`,
    [
      {
        label: s.archived || s.archived_at ? "恢复会话" : "归档会话",
        action: () =>
          updateSession(
            s.id,
            s.archived || s.archived_at ? "restore" : "archive",
          ),
      },
      { label: "取消", action: () => {} },
      {
        label: "保存名称",
        primary: true,
        action: (title) => {
          if (!title?.trim() || title.trim().length > 120) {
            throw new Error("请输入 1 至 120 个字符的会话名称。");
          }
          return updateSession(s.id, "rename", title.trim());
        },
      },
    ],
  );
}
async function updateSession(id, action, title) {
  await api("session", { action, id, ...(title ? { title } : {}) });
  await refreshOverview();
  renderSidebar();
  if (state.view === "sessions" && state.id === id) {
    state.session = await api("session?id=" + encodeURIComponent(id));
    renderConversation();
  }
  toast(
    action === "rename"
      ? "会话名称已保存。"
      : action === "archive"
        ? "会话已归档，可随时恢复。"
        : "会话已恢复。",
  );
}
function settings() {
  showDialog(
    "运行模式与连接",
    `<dl class="definition-list"><dt>当前模式</dt><dd>本地上下文与工程工具</dd><dt>模型 API</dt><dd>${state.overview.config.model_api_enabled ? "配置允许，需明确启动会话" : "已停用"}</dd><dt>工作区连接</dt><dd>${esc(location.origin)}</dd><dt>数据保存</dt><dd>本机会话、任务与 artifacts 证据目录</dd></dl><p>本地模式可以检索知识、准备计划、运行工程工具和核验结果。自由对话由原生 Pi Agent 承载，需要单独启用模型配置。</p><p class="technical-note">本地检索不调用模型。提供商用量以原生会话回执为准；外层 Codex token 单独计量。</p>`,
    [{ label: "知道了", primary: true, action: () => {} }],
  );
}
async function renderRoute() {
  state.stream?.close();
  state.stream = null;
  state.streamReconnecting = false;
  const version = ++state.routeVersion;
  closeDrawer();
  const route = parseRoute();
  state.view = route.view;
  state.id = route.id;
  state.session = null;
  state.run = null;
  $("#content").className = "content";
  $("#app").classList.toggle("engineering-mode", state.view !== "sessions");
  renderSidebar();
  renderHeader(
    {
      sessions: "工作会话",
      projects: "工程资产",
      runs: "执行记录",
      knowledge: "知识与流程",
      evaluations: "评测中心",
    }[state.view],
  );
  $("#content").innerHTML =
    '<div class="loading-state" role="status">正在读取工作区…</div>';
  try {
    if (state.view === "sessions") {
      if (state.id) {
        const session = await api("session?id=" + encodeURIComponent(state.id));
        if (version !== state.routeVersion) return;
        state.session = session;
      }
      renderConversation();
      openSessionStream(state.id, version);
    } else if (state.view === "runs") {
      if (state.id) {
        const run = await api("run?id=" + encodeURIComponent(state.id));
        if (version !== state.routeVersion) return;
        state.run = run;
        renderRun();
      } else renderRuns();
    } else if (state.view === "projects") {
      if (state.id) await loadProject(state.id);
      else await loadProjects();
    } else if (state.view === "knowledge") renderKnowledge();
    else {
      renderEvaluations();
      await loadEvaluations();
    }
  } catch (error) {
    if (version !== state.routeVersion) return;
    $("#content").innerHTML =
      `<div class="screen-error"><h2>暂时无法打开这项内容</h2><p>${esc(error.message)}</p>${button("refresh", "重新加载", "refresh")}${button("navigate", "回到工作会话", "chat", 'data-view="sessions"', "subtle")}</div>`;
  }
}
async function poll() {
  if (state.pollBusy || !state.overview || document.hidden) return;
  state.pollBusy = true;
  try {
    const version = state.routeVersion,
      id = state.id,
      previous = state.overview.jobs || [];
    const overview = await api("overview");
    state.overview = overview;
    const changed =
      JSON.stringify(previous.map((j) => [j.id, j.status])) !==
      JSON.stringify((overview.jobs || []).map((j) => [j.id, j.status]));
    if (version !== state.routeVersion) return;
    if (state.view === "sessions" && id) {
      const fresh = await api("session?id=" + encodeURIComponent(id));
      if (version !== state.routeVersion || id !== state.id) return;
      const taskSummaryChanged = JSON.stringify([fresh.agent_task_summary?.task, fresh.agent_task_summary?.goal, fresh.agent_task_summary?.task_acceptance?.status]) !==
        JSON.stringify([state.session?.agent_task_summary?.task, state.session?.agent_task_summary?.goal, state.session?.agent_task_summary?.task_acceptance?.status]);
      const messagesChanged =
        JSON.stringify(fresh.messages) !==
          JSON.stringify(state.session?.messages) ||
        JSON.stringify(fresh.tasks) !== JSON.stringify(state.session?.tasks);
      state.session = fresh;
      if (taskSummaryChanged) updateAgentTaskStrip();
      if (messagesChanged) {
        renderMessages();
        renderSessionList();
      }
    }
    if ($("#active-jobs")) $("#active-jobs").innerHTML = busyJobsHtml();
    if (changed) {
      const ended = (overview.jobs || []).filter(
        (j) =>
          !["running", "queued", "cancel_requested"].includes(j.status) &&
          previous.some(
            (p) =>
              p.id === j.id &&
              ["running", "queued", "cancel_requested"].includes(p.status),
          ),
      );
      if (ended.length) {
        const agent = ended.find(
          (job) => job.kind === "agent" && job.session_id === state.id,
        );
        if (agent && state.live.has(state.id)) {
          const live = state.live.get(state.id);
          live.status = agent.status;
          updateLiveDisplay(live);
        }
        toast(
          `任务${statusNames[ended[0].status] || "已结束"}，结果与证据已保存。`,
        );
        if (state.view === "evaluations") await loadEvaluations();
        else if (state.view === "runs" && !state.id) renderRunList();
      }
    }
  } catch {
  } finally {
    state.pollBusy = false;
  }
}
document.addEventListener(
  "click",
  guard(async (event) => {
    if (event.target.closest(".skip-link")) {
      event.preventDefault();
      $("#content").focus();
      return;
    }
    const b = event.target.closest("[data-action]");
    if (!b || b.disabled) return;
    const action = b.dataset.action;
    if (action === "submit-custom-plan") return;
    const actions = {
      navigate: () => go(b.dataset.view),
      "new-session": newSession,
      "project-open": () => go("projects", b.dataset.id),
      "project-source": () => openProjectSource(b.dataset.path),
      "project-report": () => projectReport(b.dataset.domain),
      "project-module": () =>
        openProjectSource(b.dataset.path, Number(b.dataset.line)),
      "source-range-load": async () => {
        const range = sourceRange();
        await openProjectSource(
          range.path,
          range.start_line,
          range.end_line - range.start_line + 1,
        );
        if (state.projectSource?.path === range.path && $("#source-end")) {
          $("#source-start").value = range.start_line;
          $("#source-end").value = range.end_line;
          document
            .querySelectorAll(".source-line")
            .forEach((row) =>
              row.classList.toggle(
                "selected",
                Number(row.dataset.line) >= range.start_line &&
                  Number(row.dataset.line) <= range.end_line,
              ),
            );
        }
      },
      "source-next": () =>
        openProjectSource(state.projectSource.path, Number(b.dataset.start)),
      "source-line": () => {
        const line = Number(b.dataset.line),
          start = Number($("#source-start").value);
        if (event.shiftKey) {
          $("#source-start").value = Math.min(start, line);
          $("#source-end").value = Math.max(start, line);
        } else {
          $("#source-start").value = line;
          $("#source-end").value = line;
        }
        document
          .querySelectorAll(".source-line")
          .forEach((row) =>
            row.classList.toggle(
              "selected",
              Number(row.dataset.line) >= Number($("#source-start").value) &&
                Number(row.dataset.line) <= Number($("#source-end").value),
            ),
          );
      },
      "scope-add": addScopeRange,
      "scope-remove": () => {
        selectedProjectRanges().delete(b.dataset.path);
        renderScopeSelection();
      },
      "change-plan": newChangeDrawer,
      "change-open": () => openChange(b.dataset.id),
      "change-edit": () =>
        renderChangeDrawer({ ...state.change, status: "planned" }),
      "change-check": async () => {
        const result = await api("changes", {
          action: "check",
          id: b.dataset.id,
        });
        renderChangeDrawer(result);
      },
      "change-apply": async () => {
        b.disabled = true;
        try {
          const result = await api("changes", {
            action: "apply",
            id: b.dataset.id,
            preview_digest: state.change.preview_digest,
          });
          renderChangeDrawer(result);
          await refreshProjectChanges();
          toast("已生成隔离源码候选，工程验证尚未执行。");
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      },
      "select-session": () => go("sessions", b.dataset.id),
      "toggle-archive": () => {
        state.archive = !state.archive;
        renderSidebar();
      },
      "toggle-rail": () => $("#app").classList.toggle("rail-open"),
      "session-menu": () => sessionMenu(b.dataset.id),
      "restore-session": () => updateSession(b.dataset.id, "restore"),
      settings,
      starter: () => {
        state.phase = b.dataset.phase;
        state.drafts[state.id || "new"] = b.dataset.query;
        saveDraft();
        $("#message-input").value = b.dataset.query;
        $("#phase-select").value = state.phase;
        $("#message-input").focus();
      },
      templates: templatesDrawer,
      'agent-task':agentTaskDrawer,
      'agent-task-details':agentTaskDetails,
      'agent-task-start':startAgentTask,
      'agent-task-detach':async()=>{await api('agent-task',{action:'detach',session_id:state.session.id});state.session=await api('session?id='+encodeURIComponent(state.session.id));closeDrawer();renderConversation();},
      "close-drawer": closeDrawer,
      sop: () => showSop(b.dataset.id),
      "context-detail": () => renderContextDetail(b.dataset.key),
      "plan-template": async () => {
        b.disabled = true;
        try {
          await planTask(b.dataset.spec);
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      },
      "task-detail": () => planDetails(state.tasks.get(b.dataset.id)),
      "run-task": async () => {
        b.disabled = true;
        try {
          await runTask(b.dataset.id);
        } finally {
          if (b.isConnected) b.disabled = false;
        }
      },
      "cancel-job": async () => {
        await api("cancel", { id: b.dataset.id });
        await refreshOverview();
        await poll();
        toast("已请求停止，等待工具返回终态。");
      },
      "open-run": () => {
        state.runTab = "acceptance";
        go("runs", b.dataset.id);
      },
      "run-list": () => go("runs"),
      "run-tab": () => {
        state.runTab = b.dataset.tab;
        renderRun();
      },
      "run-evidence": runEvidence,
      "artifact-preview": () => previewArtifact(b.dataset.run, b.dataset.file),
      "artifact-next": () =>
        previewArtifact(
          b.dataset.run,
          b.dataset.file,
          Number(b.dataset.offset),
        ),
      "recovery-check": () => checkRecovery(b.dataset.id),
      "recovery-resume": () => resumeRecovery(b.dataset.id),
      "eval-tab": () => {
        state.evalLane = b.dataset.tab;
        state.testingFilters = {
          query: "",
          category: "",
          tier: "",
          family: "",
          status: "",
        };
        renderEvaluations();
      },
      "evaluation-launcher": evaluationLauncher,
      "testing-case": () => testingCaseDetail(b.dataset.group, b.dataset.id),
      evaluate: () => evaluate(b.dataset.suite),
      "evaluation-detail": () => evaluationDetail(b.dataset.id),
      refresh: async () => {
        await refreshOverview();
        await renderRoute();
      },
    };
    if (actions[action]) await actions[action]();
  }),
);
document.addEventListener(
  "submit",
  guard(async (event) => {
    if (event.target.id === "composer") return sendMessage(event);
    event.preventDefault();
    if(event.target.id==='agent-task-form') {
      const button=event.target.querySelector('button[type="submit"]');button.disabled=true;
      try{await prepareAgentTaskFromForm();}finally{if(button.isConnected)button.disabled=false;}
    } else if (event.target.id === "knowledge-search") {
      const version = state.routeVersion,
        b = event.target.querySelector("button");
      b.disabled = true;
      $("#knowledge-results").innerHTML =
        '<div class="inline-loading"><span class="spinner"></span>正在检索规则与操作流程…</div>';
      try {
        const c = await api("context", { query: $("#knowledge-query").value });
        if (version !== state.routeVersion) return;
        state.contexts.set("knowledge", c);
        $("#knowledge-results").innerHTML =
          `<div class="row"><span class="meta">${c.rules.length} 条相关规则</span><span class="spacer"></span>${button("context-detail", "工具与上下文", "tool", 'data-key="knowledge"', "subtle")}</div>${c.rules.length ? rulesHtml(c.rules, c.sources) : '<div class="empty-result">没有匹配规则。请补充接口、时钟或具体错误关键词。</div>'}`;
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    } else if (event.target.id === "custom-plan") {
      const b = event.target.querySelector("button");
      b.disabled = true;
      try {
        await planTask($("#custom-spec").value.trim());
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    } else if (event.target.id === "change-plan-form") {
      const b = event.target.querySelector('button[type="submit"]');
      b.disabled = true;
      try {
        const sessionId = $("#change-session").value;
        const result = await api("changes", {
          action: "plan",
          project_id: state.project.id,
          goal: $("#change-goal").value.trim(),
          selections: [...selectedProjectRanges().values()],
          ...(sessionId ? { session_id: sessionId } : {}),
        });
        renderChangeDrawer(result);
        await refreshProjectChanges();
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    } else if (event.target.id === "change-preview-form") {
      const b = event.target.querySelector('button[type="submit"]');
      b.disabled = true;
      try {
        const edits = [
          ...event.target.querySelectorAll("[data-edit-path]"),
        ].map((t) => {
          const scope = state.change.scope.find(
            (s) => s.path === t.dataset.editPath,
          );
          return {
            path: t.dataset.editPath,
            replacement: t.value.replace(
              /\r?\n/g,
              scope.before.includes("\r\n") ? "\r\n" : "\n",
            ),
          };
        });
        const result = await api("changes", {
          action: "preview",
          id: state.change.id,
          edits,
        });
        renderChangeDrawer(result);
        await refreshProjectChanges();
      } finally {
        if (b.isConnected) b.disabled = false;
      }
    } else if (event.target.id === "agent-evaluation") {
      await launchEvaluation("online-agent", {
        session_directory: $("#agent-session").value.trim(),
        workflow_directory: $("#agent-workflow").value.trim(),
      });
    }
  }),
);
document.addEventListener("input", (event) => {
  if (event.target.id === "message-input") {
    state.drafts[state.id || "new"] = event.target.value;
    saveDraft();
  } else if (event.target.id === "session-search") {
    state.sessionQuery = event.target.value;
    renderSessionList();
  } else if (event.target.id === "run-search") {
    state.runQuery = event.target.value;
    renderRunList();
  } else if (event.target.id === "project-search") {
    state.projectQuery = event.target.value;
    renderProjectList();
  } else if (event.target.id === "project-file-search") {
    state.projectFileQuery = event.target.value;
    renderProjectFiles();
  } else if (event.target.id === "testing-query") {
    state.testingFilters.query = event.target.value;
    renderTestingCases();
  }
});
document.addEventListener("change", (event) => {
  if (event.target.id === "interaction-mode") {
    state.interaction = event.target.value;
    syncComposerMode();
  }
  if (event.target.id === "phase-select") state.phase = event.target.value;
  if (event.target.id === "run-filter") {
    state.runFilter = event.target.value;
    renderRunList();
  }
  if (event.target.id === "project-filter") {
    state.projectFilter = event.target.value;
    renderProjectList();
  }
  if (event.target.id === "project-file-filter") {
    state.projectFileFilter = event.target.value;
    renderProjectFiles();
  }
  if (
    [
      "testing-category",
      "testing-tier",
      "testing-family",
      "testing-status",
    ].includes(event.target.id)
  ) {
    state.testingFilters[event.target.id.slice(8)] = event.target.value;
    renderTestingCases();
  }
});
document.addEventListener("keydown", (event) => {
  if (
    event.key === "Enter" &&
    event.target.id === "message-input" &&
    !event.shiftKey &&
    !event.isComposing
  ) {
    event.preventDefault();
    $("#composer").requestSubmit();
  }
  if (event.key === "Escape") {
    if ($(".drawer")) closeDrawer();
    $("#app").classList.remove("rail-open");
  }
  if (event.key === "Tab" && $(".drawer")) {
    const focusables = [
        ...$(".drawer").querySelectorAll(
          "button,input,select,textarea,a,summary",
        ),
      ].filter((x) => !x.disabled),
      first = focusables[0],
      last = focusables.at(-1);
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last?.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first?.focus();
    }
  }
});
window.addEventListener("hashchange", () => void renderRoute());
try {
  await refreshOverview();
  if (!location.hash) {
    const inventory = await api("projects");
    const preferred =
      inventory.projects.find((p) =>
        /axi.*fabric|fabric.*axi/i.test(p.title + " " + p.publicPath),
      ) ||
      inventory.projects.find((p) => p.implementation === "sources_present");
    history.replaceState(
      null,
      "",
      preferred
        ? "#/projects/" + encodeURIComponent(preferred.id)
        : "#/projects",
    );
  }
  await renderRoute();
} catch (error) {
  $("#content").innerHTML =
    `<div class="screen-error"><h2>本地工作区连接失败</h2><p>${esc(error.message)}</p>${button("refresh", "重新连接", "refresh")}</div>`;
}
setInterval(() => void poll(), 2200);
