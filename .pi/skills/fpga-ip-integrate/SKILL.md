---
name: fpga-ip-integrate
description: Integrate an existing Vivado IP or Block Design into reproducible simulation and implementation. Use for generated HDL, simulation libraries, IP version compatibility, missing models or unresolved black boxes.
---

# IP integration

1. 固定 Vivado 版本、器件、IP VLNV、参数、license 状态和输入文件。用 `eda_vivado_find_ips` 查询当前安装提供的精确 IP；目录命中不代表该配置已生成或获得许可证。
2. 通过已接通的工程/IP/BD 工具或审查过的 Tcl 创建独立候选工程，导出可复建 Tcl、配置与依赖。失败可能留下部分工程状态，先检查实际文件再继续。
3. 生成仿真模型与所需库，检查编译顺序、include、宏、VHDL 版本和初始化文件。`eda_xsim` 的源文件列表不会自动生成 IP 模型；缺依赖时不能用空桩替代后宣称通过。
4. 将 RTL、XCI、XDC、生成配置与测试参考明确纳入固定 inputs。仿真和综合使用一致的 DUT 源与参数；testbench top 与 design top 可不同。
5. 先用固定功能 checker 和错误注入核验 wrapper，再综合检查 black_boxes=0。最后检查 setup/hold、约束、routing 和 DRC；IP 自带示例通过不代表本工程集成成功。

输出依赖清单、版本/配置、复建入口、功能和实现证据及未完成项。遇到新版本命令或可选 Ross MCP 时先检查真实可用性。

Knowledge IDs: FPGA-TOOL-002, FPGA-TIMING-001, FPGA-TRACE-001, FPGA-XPROP-001.

References: [rules](../../../knowledge/rules.json), [tool contracts](../../../docs/reference/tools.md).
