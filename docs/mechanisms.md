# EDA Agent 核心机制与核验范围

本项目将 EDA 工作拆成知识与操作指导、任务合同、工具执行、设计验收和证据恢复。代码可以强制执行的约束与需要工程判断的内容分别记录。下表按现有调用链检查，不按工具数量推断成熟度。

| 机制 | 代码落点与已有行为 | 当前限制 |
|---|---|---|
| 单一工具合同 | [extension.ts](../src/extension.ts) → [tool-contracts](../src/tool-contracts.mjs)；Pi、CLI、MCP 共用注册表，固定选择器不能被隐藏参数覆盖 | 接口别名共用执行器；不会增加设计能力数量 |
| 知识检索与 SOP | [knowledge](../src/knowledge.mjs) → [platform](../src/platform.mjs)；有排名、来源、适用条件、文件哈希和统一 SOP 入口 | 检索指导与设计证明分别判断；详见 [知识与 SOP](knowledge-and-sops.md) |
| 阶段与工具选择 | [task-context](../src/task-context.mjs)；阶段、规则关联选择最多两个 SOP，返回对应实际 schema 与重新核验的任务状态 | 不自动替换模型当前工具集合；无 blind SOP 选择分数 |
| 宿主工程目标 | [task-outcome](../src/task-outcome.mjs)；三类 profile，固定身份/时钟/DCP 来源，回读已提交结果，分领域判定 | 参考模型独立性、formal 与硬件另行验收 |
| 生成与独立验证循环 | [verifier-loop](../src/verifier-loop.mjs) → 固定 workflow → 原版 ACE-RTL 反馈 → 同一 Pi 会话修复；限定 RTL、累计调用预算、重复失败停止、最终证据复核 | 显式配置启用；离线假 EDA 验证，真实模型/设计质量尚未测评；修改范围是漂移检查，不是 OS 沙箱 |
| 长任务状态恢复 | [eda-coordinator](../src/eda-coordinator.mjs)；每次 context 回读绑定 workflow，按当前会话分支恢复目录指针，压缩后重建工程事实 | 保留 Pi 默认压缩；恢复公开状态和证据，不还原模型内部推理 |
| Agent 上下文与会话 | [agent-resources](../src/agent-resources.mjs) → [agent-session](../src/agent-session.mjs)；CLI/工作台共用 Pi 驱动，加载项目技能、记录 resources_loaded、续接本项目会话文件并冻结续接前记录 | API 当前停用；真实 loader 与假 SDK 验证不等于真实 provider 评估；无 steer/compaction 操作界面 |
| 多工具任务合同 | [workflow](../src/workflow.mjs)；固定规格/输入/知识/代码，解析前序结果引用，每步显式 checks；失败即停 | 串行流程；不自动补充未声明的设计验收项 |
| 本地会话与评测 | [workbench](../src/workbench.mjs)、[workbench-state](../src/workbench-state.mjs)、[evaluations](../src/evaluations.mjs)；持久会话/任务/job/事件，计划哈希复核、取消和所有者检查；六类评测独立计分 | 本机单用户；重启不自动重放；真实线上会话成绩尚未实测 |
| 工程资产与测试分类 | [workbench-projects](../src/workbench-projects.mjs)、[workbench-testing](../src/workbench-testing.mjs)；工程/源码/模块声明关联固定输入、领域报告；五层测试展开逐例、历史与独立分母 | 词法声明不等于层次展开；历史证据不代表当前重跑；只有汇总日志的测试不补造逐例结果 |
| 限定源码修改 | [workbench-changes](../src/workbench-changes.mjs)；预览 SHA、文件与行范围、原件快照、差异指纹、受保护输入和单次候选创建；每次写前检查漂移 | 仅此修改接口约束；不是任意 shell 的沙箱；源码候选尚需绑定完整依赖与工程验证 |
| 资源与进程管理 | [runtime](../src/runtime.mjs)；FIFO 资源租约，跨进程调度、超时、取消与所有者检查 | 默认 XSim 2 / Vivado 1 / LTspice 1；主机执行，不是容器或 VM 沙箱 |
| 输入与 trace | [trace](../src/trace.mjs)；依赖捕获、字节快照、哈希、进程状态、因果 span；保留失败 | 动态 Tcl/文件依赖可能无法解析；前后哈希不能检测修改后又恢复的瞬时变化 |
| 功能验收 | [bench/acceptance](../src/bench/acceptance.mjs)；检查 PASS、计数、错误、超时、负控原因及数值 oracle | 特定 harness 的覆盖；仿真通过不代表无界证明 |
| 物理报告诊断 | [fpga](../src/tools/fpga.mjs) + [Tcl](../src/tools/vivado-common.tcl)；setup/hold、内部/IO 约束、routing、CDC 与 DRC 严重级别计数分别报告 | CDC 未识别为 unknown；DRC warning 需审查；单工具的整体验收仍为 not_evaluated，绑定 workflow profile 才做任务核验 |
| 工程/IP/BD 操作 | [vivado_workbench](../src/vivado_workbench.py)；13 个 wb_* 操作、持久会话与工程导出 | 修改失败可留下部分工程状态；导出的工程仍可能引用原文件 |
| 跨 MCP 证据 | [traced-mcp-proxy](../src/traced-mcp-proxy.mjs)；社区/LTspice 调用共用资源额度与 trace | 代理边界已验；原始工具内部不会自动具有完整分布式 span |
| 成绩的可比性 | [results](../src/results.mjs)、[bench/compare](../src/bench/compare.mjs)；固定 task set、协议、scope、单位与输入 | 哈希证明文件一致性，不是第三方复现；缺失原件标 unavailable |
| 本地观测导出 | [trace-export](../src/trace-export.mjs)、[otlp-upload](../src/otlp-upload.mjs)；本地 OTLP、显式接收端上传 | 默认不外传；云端鉴权和平台接收需单独验收 |

## 物理优化的准入与复测

[工具](../src/tools/optimizer.mjs) → [runner](../src/fpga_optimizer/runner.py) → [core](../src/fpga_optimizer/core.py) → [本机 MCP 后端](../src/fpga_optimizer/backend.py)。

1. 对 routed DCP 测基线，提取 WNS/TNS、hold、pulse width、完整布线、DRC、时钟/IO 约束、器件和逻辑/约束指纹。
2. 候选必须先满足准入条件：hold/pulse width 无违例，布线完整，DRC 与约束检查可知且符合要求，器件、接口、网表和约束指纹保持一致。
3. 从 7 个已适配物理策略中路由动作，按试验数、时间、耗时估计及停滞条件停止；拒绝候选和失败仍保留。
4. 最终复测所选 DCP，记录 `winner_recheck`、`input_unchanged`、`outcome` 与实际收益。历史 AXI 两候选运行收益是 **0 ns**。

逻辑序列化指纹相同不等于形式等价。该循环没有自动 RTL 重写的等价证明机制。`eda_vivado_optimize mode=plan` 也启动 Vivado；纯静态计划应使用 `eda_workflow_plan` 或只读检查。

## 三种恢复路径

| 路径 | 可以恢复什么 | 边界 |
|---|---|---|
| workflow `resume_check/resume` | 提交完成的步骤前缀；验证原规格、知识/代码/输入、子 trace 和输出哈希 | 新目录继续，累计预算；同失败三次后要求诊断；未提交步骤可能重做；无全局请求去重或 exactly-once |
| 优化器 `recovery-check` / `resume_from` | 已提交候选边界和最佳候选 | 新运行重新测基线与最佳候选；检查原所有者与子进程 |
| [replay-experiment](../scripts/replay-experiment.mjs) | 最初四类原生调用的参数与匹配输入 | 不自动支持全部新工具，不自动恢复历史源文件或许可证环境 |

硬崩溃后不能确定停止时刻时，workflow 保守计入最后 checkpoint 到恢复的整个间隔。原进程仍可能存活时拒绝恢复。Pi 模型会话属于另一层：驱动可用 SessionManager.open 续接本项目的会话文件，保留续接前快照；目前仅有假 SDK 生命周期验收。SDK 初始化和取消为合作式退出，超时请求不能证明后端已停止。

## 仍需工程补全的部分

当前任务闭环由 [agent-task.mjs](../src/agent-task.mjs) 补齐候选准备、独占 attempt、累计续跑检查和证据交付；`agent-session.mjs` 统一 CLI/工作台入口。验证循环会自动按失败域选择 RAG/SOP，Pi context hook 重建固定范围和剩余预算。使用与明确边界见 [任务生命周期](agent-lifecycle.md)。

- 独立盲测和新 workflow 的真实 AXI/多时钟全流程验收。
- SOP 的自然语言逐项遵循评估和答案引用核验；验证任务已有按证据自动检索，普通聊天仍按需检索。
- 真实板卡、仪器、形式证明和完整 CDC 签核；当前是板外/OOC 证据。
- IP 仿真模型与库的自动依赖编排、板级约束与 bitstream 交付流程。
- DRC waiver 审查、更广的模型停滞治理、远端 Linux 执行及强隔离；当前 verifier loop 已覆盖同候选同失败重复停止。
- 真实 Pi 多轮/压缩/steer 验收、动态模型工具发布、多用户权限与独立线上评测。

本轮与 ERP 的具体源码对照、工作台用法见 [ERP 对照](erp-parity-and-workbench.md)，分类测评见 [评测协议](evaluation.md)。

验证记录按 [功能成绩](results.md) 查询。历史协作与 trace 设计保留在 [原文入口](agent-framework-and-traces.md)；当前详细 trace 合同见 [操作合同](agent-workflow-and-trace-contract.md)。
