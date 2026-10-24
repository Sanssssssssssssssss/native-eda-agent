---
name: fpga-rtl-verify
description: Verify FPGA RTL with independent reference results, reset and backpressure scenarios, negative controls, and retained native tool evidence. Use for functional correctness checks or debugging a simulation failure.
---

# RTL verification

先检索 `eda_knowledge` 的 reset、width、handshake、Xprop 和 negative-control 条目；核对编译顺序、top、宏、include、memory 初始化文件及工具语言支持。

1. 固定 DUT 与参考模型的来源，写出可计数的验收条件：用例数、事务数、字节/运算检查、reset/背压覆盖和超时。参考结果与 DUT 实现保持独立。
2. 原生调用 `eda_xsim({sources:[...],top:"...",pass_marker:"固定 checker 的精确标记",capture_top_wave:false})`；有具体调试需求时开启波形。CLI 等价入口为 `node scripts/eda-tool.mjs eda_xsim arguments.json`。已有系统可运行 `python projects/system-bench/run.py aes sim`，项目名也可为 soc/dma/udp。
3. 同时检查退出码、错误/timeout、预期 PASS marker 与计数；没有明确验收信息时报告证据不足。用 `eda_trace({directory:"实际返回目录"})` 查看本次 trace。
4. 运行与目标检查对应的负控，要求特定 scoreboard/断言拒绝。编译失败、缺文件、超时不等于负控命中。保留正负结果各自的输入与日志。
5. 若使用 formal，先确认 Yosys/SBY/solver 已安装，报告模式、深度、假设、cover、counterexample；本 skill 不把未运行 formal 写成已证明。

输出结论、计数、失败原因、run 目录、输入 hash/seed 与剩余覆盖。Verilator 两态检查不能代替 XSim 四态检查；仿真通过不建立器件时序或硬件结论。

在 [workflow](../../../docs/workflows.md) 中选 `guidance.sop_ids:["fpga-rtl-verify"]` 可冻结本 SOP 与引用规则。按任务定义独立的功能检查和负控检查；自动工作流只强制执行已声明的 checks。

Knowledge IDs: FPGA-HANDSHAKE-001, FPGA-HANDSHAKE-002, FPGA-XPROP-001, FPGA-XPROP-002, FPGA-FORMAL-001, FPGA-NEGATIVE-001.

Local references: [rules](../../../knowledge/rules.json), [native CLI](../../../scripts/eda-tool.mjs), [system runner](../../../projects/system-bench/run.py).
