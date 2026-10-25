---
name: fpga-cdc-review
description: Review multi-clock FPGA crossings, reset release, bus coherency and CDC report evidence. Use when clock domains interact, CDC warnings remain, or a clean simulation is being interpreted as CDC correctness.
---

# Multi-clock review

1. 固定时钟域、频率关系、异步复位及释放方式。读取实际 clocks 与约束；列出单比特、脉冲、计数器、多位总线、数据流各自跨域位置。
2. 用 `eda_vivado_report_cdc` 取得报告，再用 `eda_vivado_query_cells` / `eda_vivado_query_clocks` 观察同步器、FIFO 与时钟对象。报告来自本次接受的 routed DCP；旧工程的报告不能替代。
3. 对每条 warning 保留 rule ID、数量、起止对象与解释。两级同步器不能保证任意多位总线同时被一致采样；检查握手、Gray 编码、异步 FIFO 及数据稳定窗口的实际实现。
4. 功能仿真覆盖时钟比、相位、复位顺序、突发与背压；将 checker 的独立性与覆盖范围写清。仿真没有出现错误不能证明亚稳态不存在。
5. 若任务要求 CDC 验收，将 acceptance.bindings.cdc 绑定到同一 routed DCP 的报告步骤。unknown 和 review_required 不能自动变成通过；waiver 要有明确对象、理由与独立审查，当前执行器没有自动 waiver 入口。

输出 crossing 清单、已核验结构、未解决 warning、对应报告及输入哈希。形式证明、MTBF 和板级实验分别记录；缺少工具或证据时保留未验收。

Knowledge IDs: FPGA-CDC-001, FPGA-CDC-004, FPGA-RESET-001, FPGA-TRACE-001.

References: [rules](../../../knowledge/rules.json), [workflow](../../../docs/workflows.md).
