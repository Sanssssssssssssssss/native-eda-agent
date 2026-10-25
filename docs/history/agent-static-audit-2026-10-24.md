# Agent 静态审计与改进

这是首次静态审计快照；后续代理、恢复、OTLP 与配置交付见 [Agent 闭环](../agent-completion-2026-10-24.md)，下文计数与当时限制保留。

已补齐原生工具到优化器决策、候选和 MCP 调用的 trace，并增加离线证据检查及 Agent 导航文档。本轮没有启动 Vivado、没有调用其他模型 API；没有新增 FPGA 成绩。当前 Codex token 未单独计量。

| 静态发现 | 已完成改进 |
|---|---|
| 外层进程 trace 与优化器内部仅靠目录对应 | 传递 trace/span/父 run；候选、复测、MCP 调用形成子 span |
| 仅保存最新结果，无法还原决策和回退顺序 | 追加计划、预算、验收、最佳 DCP 更新、停止和终态事件；保存证据哈希 |
| 候选全失败也可能只看到 `completed` | 增加 `outcome/next_action`；明确无收益、全失败、拒绝、预算不足和复测未通过 |
| 无内层 trace 检查，异常中断容易被误读 | `eda_trace` 核验父子关系、候选终态、选中 DCP、证据哈希和多文件一致性；不完整结果不给可审阅 checkpoint |
| MCP 传输异常没有响应日志，清理异常可能覆盖原错误 | 异常也记录调用终态和本地日志；清理失败保留原异常及单独清理记录 |
| Pi SDK 字段与检查器不兼容，初始化失败缺事件 | 兼容旧字段；新 SDK 事件带统一字段，并记录初始化失败终态 |
| 文档工具数和复跑范围过时、缺 Agent 路由指引 | 增加统一导航、能力与 trace 矩阵、结果解释、恢复操作；修正 16 接口口径与复跑支持范围 |

当前使用入口：[Agent 工作流与 trace 合同](../agent-workflow-and-trace-contract.md)，并写入项目 [AGENTS.md](../../AGENTS.md) 和 Pi 系统提示，供后续 Agent 自动遵循。历史[协作 trace 文档](../agent-framework-and-traces.md)保留。

验证使用假 EDA 后端和本机子进程/MCP 注册服务：Python **21/21**、Node **9/9** 通过，覆盖跨 Node/Python 关联、DCP 篡改、错误父 span、缺终态、事件截断、空结果、取消、回退、传输超时及清理失败。这是软件检查数量，不是 FPGA 题目成绩。源文件语法检查和 Markdown 本地链接核对另有回执：

- Python 优化器与后端日志 (local/optional evidence; see results/catalog.json)。
- Node trace、兼容与 MCP 日志 (local/optional evidence; see results/catalog.json)。
- 最后的外层失败状态检查 (local/optional evidence; see results/catalog.json)，在同一 Node 集成用例中验证，不重复计数。
- 静态文件、链接与 trace 格式盘点 (local/optional evidence; see results/catalog.json)。

首轮离线测试暴露了 Windows 默认编码读取和 Node 文件大小字段使用错误，均已修复；Python 首轮 (local/optional evidence; see results/catalog.json)和 Node 首轮 (local/optional evidence; see results/catalog.json)保留，避免只呈现通过记录。

尚未闭合：社区直接 `wb_*` 回执与外部 MCP 的统一关联、OpenTelemetry/Langfuse exporter、优化器中断续跑、完整动态依赖捕获、功能形式证明和板卡验收。Pi 会话本轮只检查代码与离线格式，未开启模型会话。新 MCP 生命周期追踪仍需未来授权实跑验证；此前两次 reroute 候选的真实成绩不随本轮修改而重算。
