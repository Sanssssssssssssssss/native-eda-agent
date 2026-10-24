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

可选 `guidance` 把知识和流程选择一起冻结，例如 `"guidance":{"rule_ids":["FPGA-TIMING-001"],"sop_ids":["fpga-rtl-verify"]}`。计划返回规则范围、来源版本、所需证据与文件哈希；修改规则、知识实现或所选 SOP 后，旧任务不能继续恢复。先用 `eda_knowledge` 检索，再用 `eda_sop` 读取流程。选择 SOP 是指导信息，步骤的 `checks` 才会执行验收；当前不会自动把 prose 转成测试。

后一步可以引用已完成步骤的输出，避免手抄临时 DCP 路径：

```json
{"checkpoint":{"$result":{"step":"synthesis","pointer":"/fpga/artifacts/synthesized.dcp"}}}
```

只允许引用更早步骤。静态参数在 plan 阶段校验，引用的具体值在派发前校验。允许的工具限于本地只读查询与创建独立产物的原生 FPGA 操作；任意 Tcl、交互式工程修改、板卡烧录和嵌套工作流不在本版本范围内。

样例：

- [离线证据复核](../examples/workflows/offline-review.json)：前检 → 读取复核 SOP → 历史证据核验；可立即执行。
- [counter 仿真](../examples/workflows/counter-simulation.json)：固定 checker 的明确 PASS 判定；会启动 XSim。
- [AXI 3×3 工程](../examples/workflows/axi-fabric-ooc.json)：仿真 → 综合 → 布局布线 → DRC 报告；会启动 EDA，公开 checkout 先获取固定 RTL 依赖。DRC 步骤只验报告生成，报告内容仍须审查；它不宣称 DRC 为零或完整签核。本轮只验证该规格的静态计划。

## 恢复与证据

每个边界先写入并 fsync 不可变 `checkpoints/*.json`，记录提交事件，再原子更新 `workflow.json` 指针。完成步骤的结果单独存档。子工具通过原生注册表执行，共用原有资源租约，并继承父 trace/span。流程本身不持有 Vivado 执行额度，避免等待子工具时自锁。

恢复创建新运行，保留源运行；重新检查原规格、输入、执行代码、预算、完成步骤、子 trace 和输出哈希。活跃所有者或未结束子进程会阻止恢复。失败阶段重新执行，先前通过的阶段仅在证据一致时复用。调用数和执行耗时沿恢复链累计；正常终止后的用户等待不计入执行预算。若进程硬崩溃且缺少终态，无法确定真实停止时刻，则保守计入最后 checkpoint 至恢复的整个间隔，包括等待时间；超额后需新任务，不能通过崩溃重置预算。

只有最后一行未写完的 JSONL 可作为中断尾部忽略；中间损坏、跳号和错误提交指针均拒绝。输入/实现改变后应创建新任务，不沿旧状态续跑。

边界：这是串行任务恢复，不提供数据库事务、全局请求去重或 exactly-once 外部副作用保证。对同一旧状态显式发起两次 resume 会创建两个分支；共享资源额度仍约束其子工具。中断后尚未提交的步骤可能重做，因此工作流只接纳可在独立产物目录重做的操作。哈希检验一致性，不提供对本机恶意篡改者的认证。

`outcome=passed` 只表示该规格声明的检查通过。功能、时序、CDC、DRC、形式验证和上板必须分别声明和验收。自动依赖识别覆盖字面 sources/constraints/checkpoint、include 目录及显式 inputs；动态文件依赖仍须人工列入 inputs。当前工作流检查可列出全部子证据；OTLP 导出子运行时仍须明确给出对应运行目录。
