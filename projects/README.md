# FPGA 工程与流程索引

先选择任务目标，再固定顶层、器件、时钟、约束、checker 与依赖版本。项目中的 seeds、事务和字节数是覆盖量；历史成绩按 [功能](../docs/results.md) 查询。

| 工程 | 主要内容 | 适合验证什么 |
|---|---|---|
| [fft-spectrum](fft-spectrum/README.md) | 1024 点 FFT、数值参考与固定刺激 | DSP 数据通路、定点数值、帧与频点检查 |
| [system-bench](system-bench/README.md) | SoC / DMA / UDP / AES | 外设与存储事务、协议、加密流水线集成 |
| [hard-bench](hard-bench/README.md) | AXI 3×3 / 三时钟 Ethernet / RV32IM AES DMA | 并发主机、CDC、软核与 DMA 组合工程 |
| [native-vivado-workbench](native-vivado-workbench/README.md) | 工程 / IP / Block Design | 工程装配与 Tcl 导出 |
| [verilogeval-24](verilogeval-24/README.md) | 固定 24 题与参考测试 | RTL 功能回归与超时协议诊断 |
| [FPGA 工具样例](fpga-tool-validation) | 固定 XDC 与工具操作输入 | typed 工具的参数和报告链路 |

公开 checkout 用 `node scripts/fetch-example-upstreams.mjs` 获取固定版本的公共 RTL。历史工程可能保留旧绝对路径：先运行 `node scripts/relocate-examples.mjs` 查看迁移计划，需要时加 `--apply`，脚本保留备份；部分固件生成另需 RISC-V 工具链。

新增任务可参考 [counter workflow](../examples/workflows/counter-simulation.json) 与 [AXI workflow](../examples/workflows/axi-fabric-ooc.json)，在 guidance 中声明使用的 SOP，在 steps 中固定验收。当前新 AXI 编排只静态计划过，不能用旧工程成绩代替本版本全流程实跑。

Tcl 通过 EDA_WORKSPACE 获取根目录，每次原生执行使用新的 artifacts 目录。LTspice 输入放在 examples/analog；AC 和 transient 分开执行，并读取实际 .meas 结果。
