# 持久化任务工作流

`eda_workflow_plan/run/inspect/resume_check/resume` 将多个原生工具串成有固定验收条件的任务。规格、输入/代码哈希、累计预算、每步结果、子 trace 和输出产物哈希均落盘。任务顺序由 JSON 定义；没有模型调用或自动改写验收标准。

```powershell
node scripts/workflow.mjs plan examples/workflows/offline-review.json
node scripts/workflow.mjs run examples/workflows/offline-review.json
node scripts/workflow.mjs inspect artifacts/WORKFLOW_RUN
node scripts/workflow.mjs resume_check artifacts/FAILED_WORKFLOW_RUN
node scripts/workflow.mjs resume artifacts/FAILED_WORKFLOW_RUN
```

`plan` / `inspect` / `resume_check` 只做本地检查并记录自己的查询 trace。`run` / `resume` 会执行声明的工具；真实 EDA 需要已安装软件与可用许可证。CLI 验收失败返回非零退出码，MCP 返回 `isError=true`，同时保留结构化 outcome。

## 规格与验收

完整 schema 可用 `node scripts/workflow.mjs schema` 获取。规格包含 `id`、`goal`、输入文件、`limits.max_calls` / `wall_seconds` 和有序 `steps`。每步必须给出工具参数和至少一条检查。检查采用 RFC 6901 JSON pointer，支持严格 `eq`、有限数值 `gte/lte`；字段缺失、null 或错误类型不能通过数值判断。

可选 `guidance` 把知识和流程选择一起冻结，例如 `"guidance":{"rule_ids":["FPGA-TIMING-001"],"sop_ids":["fpga-rtl-verify"]}`。计划返回规则范围、来源版本、所需证据与文件哈希；修改规则、知识实现或所选 SOP 后，旧任务不能继续恢复。先用 `eda_knowledge` 检索，再用 `eda_sop` 读取流程。选择 SOP 是指导信息，步骤的 `checks` 和工程目标 profile 执行验收；当前不会自动把 prose 转成测试。

后一步可以引用已完成步骤的输出，避免手抄临时 DCP 路径：

```json
{"checkpoint":{"$result":{"step":"synthesis","pointer":"/fpga/artifacts/synthesized.dcp"}}}
```

只允许引用更早步骤。静态参数在 plan 阶段校验，引用的具体值在派发前校验。允许的工具限于本地只读查询与创建独立产物的原生 FPGA 操作；任意 Tcl、交互式工程修改、板卡烧录和嵌套工作流不在本版本范围内。

样例：

- [离线证据复核](../examples/workflows/offline-review.json)：前检 → 读取复核 SOP → 历史证据核验；可立即执行。
- [counter 仿真](../examples/workflows/counter-simulation.json)：固定 checker 的明确 PASS 判定；会启动 XSim。
- [AXI 3×3 工程](../examples/workflows/axi-fabric-ooc.json)：仿真 → 综合 → 布局布线 → DRC 报告；会启动 EDA，公开 checkout 先获取固定 RTL 依赖。步骤 checks 检查报告生成，新增工程 profile 另行读取 DRC 严重级别计数；warning 需要审查，缺失计数保持 unknown。CDC/formal/硬件不由 OOC profile 推断。

## 独立工程目标

可选 `acceptance` 在逐步 checks 之外绑定结构化目标。`rtl_simulation` 要求功能，`evidence_review` 要求证据完整性，`fpga_ooc` 要求功能、综合、setup、hold、约束、布线和 DRC。额外绑定 CDC 才会核验该域并加载 CDC SOP。

```json
{"acceptance":{"profile":"rtl_simulation","bindings":{"functional":"simulate"}}}
```

复杂规格另需固定 `design.top/part/clock/period_ns`。仿真必须包含所有综合源文件且 defines/generics/include_dirs 相同；实现必须消费绑定综合的 DCP，其他物理报告必须消费该实现的 routed DCP。工程目标不接受用前检布尔值代替功能证据。

宿主从已提交文件重新读取结果：精确匹配固定 PASS 标记；有限 setup/hold 数值满足非负门槛；约束/布线明确通过；DRC error/critical 导致 failed，warning 导致 review_required，计数缺失为 unknown。结果写入带哈希的 `task-outcome.json`。全部步骤执行结束仍可能是 `acceptance_unknown`、`acceptance_failed` 或 `acceptance_review_required`，CLI 此时返回非零。

无 acceptance 的旧规格只记录步骤结果，工程目标是 `goal_scope_unbound`；不能据此宣称整体设计完成。CDC 报告无警告只覆盖已报告检查，不等于完整 CDC 签核。formal/板卡始终单列未评估。

## 恢复与证据

每个边界先写入并 fsync 不可变 `checkpoints/*.json`，记录提交事件，再原子更新 `workflow.json` 指针。完成步骤的结果单独存档。子工具通过原生注册表执行，共用原有资源租约，并继承父 trace/span。流程本身不持有 Vivado 执行额度，避免等待子工具时自锁。

恢复创建新运行，保留源运行；重新检查原规格、输入、执行代码、预算、完成步骤、子 trace 和输出哈希。活跃所有者或未结束子进程会阻止恢复。失败阶段重新执行，先前通过的阶段仅在证据一致时复用。调用数和执行耗时沿恢复链累计；正常终止后的用户等待不计入执行预算。若进程硬崩溃且缺少终态，无法确定真实停止时刻，则保守计入最后 checkpoint 至恢复的整个间隔，包括等待时间；超额后需新任务，不能通过崩溃重置预算。

恢复链按步骤、工具参数、输入指纹和失败类别累计；同一失败三次后，`resume_check` 返回 `repeated_failure_requires_diagnosis`。不自动重试或改验收；诊断并修改输入后另建任务。全部步骤已结束但工程目标未通过时，也要求先审查目标而不是空续跑。

只有最后一行未写完的 JSONL 可作为中断尾部忽略；中间损坏、跳号和错误提交指针均拒绝。输入/实现改变后应创建新任务，不沿旧状态续跑。

边界：这是串行任务恢复，不提供数据库事务、全局请求去重或 exactly-once 外部副作用保证。对同一旧状态显式发起两次 resume 会创建两个分支；共享资源额度仍约束其子工具。中断后尚未提交的步骤可能重做，因此工作流只接纳可在独立产物目录重做的操作。哈希检验一致性，不提供对本机恶意篡改者的认证。

`outcome=passed` 表示该规格声明的步骤检查和已绑定工程目标通过；未绑定目标的旧规格只覆盖步骤检查。功能、时序、CDC、DRC、形式验证和上板必须分别声明和验收。自动依赖识别覆盖字面 sources/constraints/checkpoint、include 目录及显式 inputs；动态文件依赖仍须人工列入 inputs。当前工作流检查可列出全部子证据；OTLP 导出子运行时仍须明确给出对应运行目录。
