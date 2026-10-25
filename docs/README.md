# 文档导航

当前使用以这几份文档为准；带日期的报告保留当时的版本、失败和验证范围。

| 想了解什么 | 当前入口 |
|---|---|
| 项目能做什么、怎样启动 | [项目 README](../README.md) |
| EDA Agent 的关键机制是否实际接入 | [机制与源码落点](mechanisms.md) |
| 本地会话界面、任务可视化和 ERP 对照 | [v0.7 工作台验收](workbench-v07-acceptance.md) · [机制比较](erp-parity-and-workbench.md) |
| 离线、真实 EDA 与 Agent 会话如何分类评测 | [评测协议](evaluation.md) |
| RAG 检索、来源、SOP 与执行之间的关系 | [知识与 SOP](knowledge-and-sops.md) |
| 各功能有哪些历史成绩、如何计分 | [按功能查看成绩](results.md) |
| 定义、验收和恢复多工具任务 | [workflow](workflows.md) |
| 参数、工具选择和执行影响 | [自动生成的工具合同](reference/tools.md) |
| trace 接通范围、恢复与本地导出 | [trace 合同](agent-workflow-and-trace-contract.md) · [闭环操作](agent-completion-2026-10-24.md) |
| 修改、验证和发布 | [贡献规范](../CONTRIBUTING.md) · [版本记录](../CHANGELOG.md) · [发布回执](../release/README.md) |

## 专项参考

[Benchmark 目录](benchmark-catalog.md) · [工程/IP/BD](vivado-workbench-coverage-2026-10-24.md) · [原生 FPGA 执行器](fpga-native-tools-2026-10-24.md) · [物理优化器](native-optimizer-2026-10-24.md) · [证据存储](trace-storage.md) · [示例工程](../projects/README.md)。

## 历史证据与研究

| 主题 | 保留记录 |
|---|---|
| 最初 counter / RC / Pi 模型验收 | [2026-10-22](validation.md) |
| 初始知识与 4 个 skills | [建设记录](fpga-knowledge-and-tools.md) |
| RTL 固定题集 | [8 题](codex-vivado-score-2026-10-23.md) · [24 题及 watchdog 协议](codex-verilogeval-24-2026-10-23.md) |
| FPGA 系统工程 | [四系统](system-projects-2026-10-23.md) · [三个复杂系统](hard-system-projects-2026-10-23.md) |
| 调度、回归与独立协作 | [基础验收](agent-foundation-validation-2026-10-23.md) · [并行验证](parallel-validation-2026-10-23.md) · [协作分工](parallel-coordination-2026-10-23.md) |
| 原生工具与 Workbench | [原生验收](fpga-native-tools-validation-2026-10-24.md) · [Workbench 覆盖](vivado-workbench-coverage-2026-10-24.md) |
| Agent 实现演进 | [框架与 trace 协作](agent-framework-and-traces.md) · [静态审计](agent-static-audit-2026-10-24.md) · [v0.3 发布](release-2026-10-25.md) |
| 上游研究 | [初始选型](research-2026-10-21.md) · [开源工具对照](native-fpga-open-source-2026-10-24.md) · [成熟 Agent 源码比较](repository-comparison-2026-10-25.md) · [Ross 本机接入](ross-integration-2026-10-24.md) |

历史文件中的工具数量、环境探测和模型用量是当时的观察。当前源码/工具合同/运行回执与历史成绩分别核对；不把旧成功升级成新版本已复现。
