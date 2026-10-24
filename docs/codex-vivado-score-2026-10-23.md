# Codex 本机 Vivado 实测

2026-10-23：**VerilogEval v2 固定随机 8 题首次有效评测通过 7 题，87.5%；1024 点 FFT 核通过功能验收并完成布局布线。** 用户要求停止其他 API 后，由当前 Codex 直接调用本机工具，额外模型 API 调用为 0。

后续已完成[另外 24 道代表性题目](codex-verilogeval-24-2026-10-23.md)：原始规则 20/24，延长测试后 23/24。本页保留最初 8 题和 FFT 工程记录；8 题成绩经超时判定审计仍为 7/8。

## 成绩与量化口径

| 指标 | 本机结果 | 怎么计算 / 验收 |
|---|---:|---|
| RTL 题通过率 | **7/8 = 87.5%** | 每题必须完成仿真、存在检查样本且 mismatch 为 0；失败题保留在分母 |
| FFT 数值功能 | **16/16 帧，16,384 点** | 全量对照 NumPy FFT，固定缩放 1/2048 |
| FFT 复数分量最大误差 | **1.054 LSB** | 每点实部、虚部分别比较；预定上限 4 LSB |
| L1 幅度最大误差 | **1.799 LSB** | 比较 `abs(Re)+abs(Im)`；预定上限 8 LSB |
| 流协议与复位 | **通过** | TLAST、停顿时输出稳定、数据点数、未知值；2 次复位，5,820 次输入停顿、7,520 次输出停顿 |
| 检查器负例 | **4/4 被拒绝** | 全零输出、缩放错误、缺失 TLAST、缺失末点 |
| 布局布线时序 | **100 MHz 核内报告为正余量** | 10 ns 时钟，输入/输出延迟各 2 ns；setup **+1.643 ns**，hold **+0.046 ns**；时钟源及接口物理位置待集成确认 |
| FPGA 资源 | **2,703 Slice LUT / 4,472 FF / 12 DSP / 6 RAMB18** | 采用布局布线后的 utilization 报告 |
| 实现完整性 | **5,477/5,477 网络完成布线** | 0 布线错误、0 黑盒、0 未约束端点；12 类时序约束检查均为 0 |
| 本地工具耗时 | **小题 94.74 秒；FFT 仿真 88 秒；实现 156 秒** | 成功运行批次的墙钟时间；不含思考、调试、下载和截图时间 |

不把这些指标拼成任意权重的百分制总分。RTL 正确性、工程集成和物理实现分别判断。

## RTL 小题：抽样、失败与修正

[VerilogEval](https://github.com/NVlabs/verilog-eval) 固定提交 `c498220d0a52248f8e3fdffe279075215bde2da6`；将 156 个题号排序，用 Python `random.Random(20261023).sample(..., 8)` 抽样。Codex 依据题目写候选实现，首次结果产生前冻结全部 8 份候选；未先看所选题目的参考实现和测试逻辑。

| 题号 | 首次有效评测 | 比较样本数 |
|---|---|---:|
| Prob052_gates100 | 通过 | 433 |
| Prob062_bugs_mux2 | 失败：110 次不匹配 | 114 |
| Prob065_7420 | 通过 | 239 |
| Prob068_countbcd | 通过 | 39,805 |
| Prob091_2012_q2b | 通过 | 600 |
| Prob094_gatesv | 通过 | 213 |
| Prob137_fsm_serial | 通过 | 905 |
| Prob147_circuit10 | 通过 | 232 |

共 42,541 个样本。mux 首稿为 `sel ? b : a`，参考要求 `sel ? a : b`；查看参考后修正，单题复测 114 个样本全通过。合并看修正后的实现为 8/8，但**这是看过参考后的诊断结果，不是盲测修复成绩**。主成绩仍为 7/8。

本机使用 XSim 2020.2，属于适配版运行器：给参考副本补 `timescale 1ps/1ps`，将 TB 的两个 wire 声明前移，未改激励与判定逻辑。此前因声明顺序出现的 8 个工具错误保留在原日志。它不是官方 Icarus 运行器、完整 156 题成绩或模型排行榜 pass@1；8 题也不足以判断模型整体水平。

## FFT 工程：完成范围

参考 [SynthPilot 频谱仪教程](https://github.com/LNC0831/SynthPilot_Tutorial)（提交 `c415ec77d296b38c2bb384141eb9952f1eb84344`），复刻其 DSP 核。原作者工程含 PCIe 和浏览器显示；本机实现为 **AXI Stream → AMD FFT 9.1 → L1 幅度输出**，器件 `xc7a100tfgg676-2`，Vivado 2020.2。

集成初稿来自此前 Pi 运行；停止其他 API 后，Codex 修复配置握手、仿真脚本和执行环境，完成验收。AMD IP 提供 FFT 算法，上游幅度模块保持原样。这里测的是配置、集成、调试和核验能力。

16 帧覆盖零、冲激、DC、单/双频、Nyquist、正负满幅、chirp、6 组随机数据，以及输入间歇、输出反压、帧中复位和复位后首帧。TB、输入向量与 NumPy oracle 在实现前固定，最终 SHA-256 核对一致。

实现是 **out-of-context 核内验证**。日志提示 `HD.CLK_SRC`、`HD.PARTPIN_LOCS` 未设置，因此外部时钟延迟/偏斜和接口边界布线尚未准确建模；上述正余量属于当前 OOC 报告，集成到实际顶层后必须重验，不能作为板级 100 MHz 保证。未验证 PCIe、跨时钟域、板卡引脚、音频实时采集；未生成 bitstream、未上板。DRC 无错误，有 1 项 `CFGBVS-1` 配置电压警告。100 MHz 是本次约束，未测最高频率。

## 截图与证据

以下是打开真实 WDB / routed DCP 后截取的 Vivado 窗口。

XSim 波形 (local/optional evidence; see results/catalog.json)

布局布线及时序 (local/optional evidence; see results/catalog.json)

- 机器可读成绩 (local/optional evidence; see results/catalog.json)、小题原始成绩 (local/optional evidence; see results/catalog.json)、mux 诊断复测 (local/optional evidence; see results/catalog.json)。
- FFT 数值判定 (local/optional evidence; see results/catalog.json)、频谱对照图 (local/optional evidence; see results/catalog.json)、负例结果 (local/optional evidence; see results/catalog.json)。
- 时序报告 (local/optional evidence; see results/catalog.json)、资源报告 (local/optional evidence; see results/catalog.json)、约束检查 (local/optional evidence; see results/catalog.json)。
- [复跑说明](../projects/fft-spectrum/README.md)、[案例与公开 benchmark 调研](vivado-cases-and-benchmarks.md)。

若继续量化：固定版本和题集、每题独立会话、隐藏参考、统一修复轮数/时间预算，同时报告首次与修复后通过率、工具失败、耗时和用量。Vivado 后端优化可用 [FPL'26 官方 benchmark](https://xilinx.github.io/fpl26_optimization_contest/benchmarks.html)，但需其 Vivado 2025.1 / Linux 环境；本次未运行该竞赛。

## 用量

停止前这轮 DeepSeek Flash 已返回 25 次：输入 37,262、输出 39,312、缓存读取 1,190,528 tokens；Pi 目录价格估算 **$0.065496**，不是供应商账单。见停止记录 (local/optional evidence; see results/catalog.json)。停止后额外模型 API 调用 **0 次**；当前 Codex 会话的完整 tokens / 费用未暴露，未估算。
