---
name: fpga-timing-triage
description: Diagnose Vivado setup, hold, clock and constraint problems from actual implementation reports. Use when routed timing fails, constraints are incomplete, or a timing improvement needs a controlled comparison.
---

# Vivado timing triage

用 `eda_knowledge` 检索 timing/constraint/CDC。先记录 Vivado 版本、part/speed grade、实现阶段、时钟、XDC 和原 run。当前基线 2020.2；Ross timing skill 要求 2026.1+，使用具体选项前核对当前工具帮助。

1. 读取 process.log、build-result.json、timing-summary.rpt、check-timing.rpt、utilization.rpt、applied-constraints.xdc。缺失项显式报告。
2. 审查时钟与 IO 覆盖、例外优先级、黑盒及 DRC，再解释 slack。在打开的设计上按版本支持补充 `report_clocks`、`report_clock_interaction`、`report_cdc`、`report_exceptions`、`report_methodology` 的文本报告；不要照搬新版 JSON 选项。
3. 分别分析 setup/hold 与 pulse-width，查看路径起终点、逻辑/布线延迟、扇出、时钟偏差和拥塞。每次修改提出一个可验证原因，保持器件/约束可比。
4. 已有 DCP 优先用 `eda_vivado_setup_paths`、`eda_vivado_hold_paths` 与单项 `eda_vivado_report_*` 取得结构化证据。重新实现可用 `eda_vivado_implement`；定制 Tcl 才使用 `eda_vivado({script:"已审查的 Tcl 路径"})`。以工具返回的新目录为证据。
5. 根据实际输出填写 setup/hold slack、TNS/THS、约束覆盖、资源和修改效果。未生成的字段写 missing，不能补成零。

输出原因、改动、前后同条件结果和日志路径。OOC 固定 IO 延迟仅是实验条件，不能推出板级接口或硬件通过；静态规则不能替代实现报告。

`eda_vivado_optimize` 的 plan 也会运行 Vivado；它不是静态诊断。运行优化前固定器件、约束、网表和预算，并单独检查候选准入、最佳候选复测及实际收益。用 [workflow](../../../docs/workflows.md) 的 `guidance.sop_ids:["fpga-timing-triage"]` 记录本次采用的指导。

Knowledge IDs: FPGA-CLOCK-001, FPGA-CLOCK-002, FPGA-CONSTRAINT-001, FPGA-CONSTRAINT-002, FPGA-CONSTRAINT-003, FPGA-CONSTRAINT-004, FPGA-TIMING-001, FPGA-TIMING-002, FPGA-TIMING-003, FPGA-TOOL-002.

Local references: [rules](../../../knowledge/rules.json), [baseline Tcl](../../../projects/system-bench/implement-common.tcl), [native CLI](../../../scripts/eda-tool.mjs).
