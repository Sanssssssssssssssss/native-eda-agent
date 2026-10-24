# Trace 与存储

新工具运行保存完整过程证据；相同输入内容共享对象。历史 `artifacts/` 保留原样。两项分析脚本默认只读，不运行 EDA、不调用模型、不删除文件。

优化器新增内层 `optimizer-events.jsonl`，与外层工具共享 trace ID；`eda_trace` / `trace-inspect` 会同时核查候选证据、父 span、最佳 DCP 和终态。Pi SDK 字段兼容也已加入。完整接入矩阵、事件字段与恢复方式见 [Agent 工作流与 trace 合同](agent-workflow-and-trace-contract.md)。

## 本次盘点

2026-10-23 初次只读盘点覆盖 `artifacts/`，未遍历 `runtime/`：194 个目录、4,149 个文件，逻辑体积 **2,424,342,109 bytes**；波形 **2,254,317,037 bytes，占 92.99%**。最大的四份 XSim 产物各约 372 MB，几乎全部是波形。此数值是当时快照，会随后续运行增长。

因此未来运行默认关闭全量波形；诊断时按问题开启有限信号和时间窗口。输入去重减少重复代码、testbench、向量和 runner 快照，不能消除历史大波形。文件逻辑大小和 NTFS 实际分配空间不同；本工具没有测量压缩、稀疏文件或磁盘簇占用。

## 每次运行保留什么

| 文件 | 内容 |
|---|---|
| `run.json` | 工具参数、版本证据、关联 ID、进程、输入哈希、依赖缺口、起止状态和输入漂移 |
| `events.jsonl` | 严格递增序号、UTC 时间、trace/span/parent span、进程起止及停止原因 |
| `receipt.json` | 兼容现有调用方的 `directory`、`process_log`、结果字段，以及完整性状态 |
| `inputs/` | 按原工作区相对路径保存的只读快照 |
| `retention.json` | 证据保留规则；不自动执行清理 |
| `process.log`、EDA 原生日志、报告、DCP、XDC | 原始执行和结果证据 |

工具 `completed` 表示执行结束，功能验收仍由固定 checker 决定。失败、超时、取消、未结束、输入漂移及对象损坏都独立记录。`other_model_api_calls: 0` 只覆盖直接工具调用，外层 Codex token 和费用未知时保留 `null`。

## 输入对象与完整性

相同 SHA-256 内容保存到 `artifacts/.trace-objects/sha256/<前两位>/<完整哈希>`。每次先从原文件读取字节，再在对象目录写唯一临时文件、刷盘，原子发布；并发竞争不会覆盖已有对象。已有对象必须重新通过哈希校验，损坏时拒绝复用，不自动修复。

`inputs/` 硬链接到这些新对象，**不会硬链接到原始可变输入**。不支持硬链接时保留普通副本；对象发布仍使用锁和原子重命名。对象及快照设为只读。这是防误改措施，不是权限安全边界：手工修改任一硬链接会影响共享对象及其他快照，因此检查和复跑都重新校验哈希。源文件拥有独立数据，不受快照别名修改影响。

对象存储必须与相关 run 目录一起保留。移动或导出时复制整个证据集合；仅复制 run 目录而遗漏对象会被检查拒绝。锁/临时文件中断后不自动清理；应先确认对应进程状态，再单独评估。

旧 manifest 没有 `object_path` 时继续验证原 `snapshot` 和 SHA-256。新 manifest 同时要求对象和快照存在且匹配；对象缺失、篡改、路径越界、快照错误链接原始输入均会阻止复跑。

工具仍执行原工作区路径，快照用于保留捕获字节。执行前后哈希可发现结束时的漂移，不能证明运行期间从未发生“修改后恢复”。静态依赖发现支持常见 Verilog include/readmem/fopen、Tcl 文件路径和 SPICE include，记录识别到的缺失和歧义；不能完整识别运行时表达式或实例参数覆盖，可能捕获参数默认文件而遗漏覆盖后的文件。零未解析项也不等于完整依赖证明。复跑仍需确认工具版本、许可证和外部状态。

## 跨运行关联与事件

`createTrace({ ..., context })` 可接收以下 ID；也可用对应环境变量设置。只读取这些白名单变量，不记录整个环境或凭据。

| 字段 | 环境变量 |
|---|---|
| `campaign_id`、`case_id` | `EDA_TRACE_CAMPAIGN_ID`、`EDA_TRACE_CASE_ID` |
| `parent_run_id`、`session_id`、`thread_id` | `EDA_TRACE_PARENT_RUN_ID`、`EDA_TRACE_SESSION_ID`、`EDA_TRACE_THREAD_ID` |
| `trace_id`、`parent_span_id` | `EDA_TRACE_TRACE_ID`、`EDA_TRACE_PARENT_SPAN_ID` |

普通 ID 限 1–200 个字母、数字、下划线、点、冒号或短横线，首字符须为字母/数字。trace ID 为 32 位小写十六进制，span ID 为 16 位；非法值仅记录字段名。每个进程建立子 span，保存 exe/args/cwd/PID、起止时间、退出码和停止原因。当前使用本地 JSON/JSONL；没有新服务、数据库或自动遥测上传。

## 分析与复跑

```powershell
# 单次运行：完整性、缺证据、漂移、简短时间线
node scripts/trace-inspect.mjs artifacts/<run> --format md

# 比较两次运行：参数摘要、输入哈希、工具版本、时间及数值结果变化
node scripts/trace-inspect.mjs artifacts/<old> --compare artifacts/<new>

# 聚合第一层运行目录；历史缺 manifest 的目录会明确列缺证据
node scripts/trace-inspect.mjs artifacts --timeline-limit 0 --output artifacts/trace-summary.json

# 同时核查捕获输入和当前源文件，不启动 EDA
node scripts/replay-experiment.mjs artifacts/<run>/run.json --check-only

# 通过核查后显式启动一次新实验；不会原地恢复源文件
node scripts/replay-experiment.mjs artifacts/<run>/run.json --run
```

`trace-inspect` 默认不输出完整事件正文、提示或日志，只输出有限时间线和聚合结果；增加 `--check-current` 可核对当前源文件。字段 schema、序号、run/trace ID、进程终态、对象/快照完整性和缺失证据都进行核查。旧事件缺 span 时显示限制；无效证据返回非零退出码，不影响原文件。工具完成数不作为 benchmark 通过率。

自动复跑入口仅支持最初四个工具。优化器另有 `recover-optimizer.mjs` / `resume_from`，从已提交 journal 在新目录恢复并复测，保留旧记录；不恢复未结束候选的半成品。OTLP 导出和代理接入见 [闭环交付](agent-completion-2026-10-24.md)。旧优化器日志没有事件链/journal 时明确提示覆盖缺口。

## 存储盘点与保留计划

```powershell
node scripts/artifact-inventory.mjs --format md
node scripts/artifact-inventory.mjs --plan --minimum-age-days 7 --output artifacts/retention-review.json
```

统计区分逻辑 bytes、按文件标识去重后的 bytes、硬链接节省 bytes、输入快照 bytes、对象库 bytes 和波形占比。不会为估计内容重复而读取全部大型波形；未硬链接的相同内容不会虚报成已节省空间。

计划只列超过指定天数、已完成且未 pin 的运行波形，要求进一步确认验收及诊断价值。失败、超时、取消、运行中、未知历史、manifest 已记录的漂移/完整性失败、pinned 运行均保护。计划不重新计算内容哈希，事后损坏可能尚未记录；处理候选前须另做当前完整性检查。模拟 `.raw`、日志、JSONL、manifest、receipt、输入、对象、报告、约束和 DCP 永远不进入默认候选。可在 run 的 `retention.json` 设置 `pinned: true`。工具没有删除参数或删除实现。

## 验证

轻量测试覆盖真实 Node 子进程的成功、失败、超时、取消，四进程并发对象发布、源文件与对象隔离、对象损坏/缺失拒绝、旧 manifest 兼容、schema 错误、摘要不泄露日志正文，以及计划前后文件哈希不变。测试只写自己的独立目录；故意损坏的测试对象也局限于这些 fixture，不触碰历史实验。

```powershell
node --test tests/trace.test.mjs tests/replay-experiment.test.mjs tests/artifact-storage.test.mjs
```
