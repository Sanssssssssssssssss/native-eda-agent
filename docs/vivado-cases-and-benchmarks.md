# Vivado Agent 案例与评测选型

核对日期：2026-10-23。结论：有跑过复杂工程的案例，也有直接面向 Vivado Agent 的正式竞赛。当前本机复刻选 1024 点 FFT 信号处理核；更重的后端优化优先参考 FPL'26。

## 有源码的案例

| 项目 | 做到了什么 | 证据与适用范围 |
|---|---|---|
| [SynthPilot 音乐频谱仪](https://github.com/LNC0831/SynthPilot_Tutorial) | KU3P、PCIe Gen3 x4、1024 点 FFT、幅度计算、浏览器频谱；作者报告仿真、布局布线及硬件 DMA 测试完成 | 有 RTL、TB、IP 配置、分阶段任务书和[晓川科研站视频](https://www.bilibili.com/video/BV1jf97BLEGZ)。适合取 DSP 数据通路做适度复刻。作者使用 Claude Code + SynthPilot；本机先由 Pi 写初稿，后按用户要求由 Codex 直接调用原生工具完成修复与验收 |
| [AER 优化器](https://github.com/haeun-josue/fpl26contest-AER-optimizer) | 已布线 DCP 的时序优化，FPL'26 总排名第一 | [主办方最终结果](https://xilinx.github.io/fpl26_optimization_contest/results.html)可交叉核对。最终实现仅让 LLM 选首个动作，随后执行规则流程；停止无收益尝试，避免无界循环 |
| [复旦 PACT](https://github.com/FudanLLMEDA/PACT) | Vivado + RapidWright 的布线后优化，FPL'26 总排名第四 | 有 Agent、MCP、知识库和验证脚本。公开快照明确缺少论文完整 35 设计结果包，不能据此宣称论文全量复现 |

另有[资深开发者的社区反馈](https://www.reddit.com/r/FPGA/comments/1v71vax/claude_code_and_fpga_builds/)：FFT/插值链占约 90% Spartan-7，使用 Docker、cocotb、ModelSim，让 Agent 迭代约 20 次构建。作者明确说只做了仿真，未上硬件；这是经验分享，不是可独立复跑的公开项目。

## Benchmark 怎么选

| Benchmark | 测什么 | 对当前项目的价值 |
|---|---|---|
| **[FPL'26 Agentic FPGA Backend Optimization](https://xilinx.github.io/fpl26_optimization_contest/benchmarks.html)** | 在保留行为的前提下优化已布线工程；VexRiscv、Mini-ISP、FINN、Rosetta 等；v1.3.0 含 19 个 DCP 文件，包含不同发布版本 | 最贴近“Vivado 工程 Agent”。官方使用 Vivado 2025.1 + Linux，本机 2020.2 不具备同环境复现条件 |
| [VerilogEval v2](https://github.com/NVlabs/verilog-eval) | 156 道规格到 RTL / 代码补全任务，仿真判功能 | 适合测 RTL 编写基本功；不能证明 IP 集成、约束正确、布局布线或上板能力 |
| [RTLLM v2.1](https://github.com/hkust-zhiyao/RTLLM) | 50 个算术、存储、控制等模块，含描述、参考 RTL、testbench，原评测包括 PPA | 比 HDLBits 小题更贴近常见模块。2026-08-15 更新修过描述和 TB；旧版本成绩不能直接混比 |
| [TuRTLe](https://github.com/Silimate/turtle) | 统一运行 VerilogEval、RTLLM、RTL-Repo、NotSoTiny 等；语法、功能、综合、等价和 PPA | 适合建立可维护的多模型评测台。后端是 Icarus/Verilator/Yosys/LibreLane，不能把其 ASIC PPA 直接当 Vivado FPGA 结果 |

FPL'26 的[计分规则](https://xilinx.github.io/fpl26_optimization_contest/score.html)为 `ΔFmax × (1 − 0.1×美元费用 − 0.1×运行小时数)`，每设计限 1 小时；验证失败为零分。验证包括完整布局布线和随机仿真比较，并不构成形式等价证明。官方基线在 VexRiscv 上报告 Fmax 从 310.17 MHz 提高到 415.28 MHz；这是主办方数据，非本机测量。注意其 WNS 仍为负，Fmax 改善不等于达成原约束频率。

本次 FFT 的 16 帧工程验收属于本机集成测试，不能换算成上述公开榜单分数。要正式测 Pi：固定数据版本、隐藏参考实现、每题单独会话、统一模型/预算；分别记录首次通过、修复后通过、工具次数、耗时、tokens、费用和真实综合/时序结果。

## 本机复刻范围

- 上游固定为 `c415ec77d296b38c2bb384141eb9952f1eb84344`，本地 `vendor/SynthPilot_Tutorial/` 保留原文件。
- 重建 FFT 9.1 IP，迁移到 Artix-7 / Vivado 2020.2；实现流式输入、配置/复位、FFT、L1 幅度计算。
- 预先固定 testbench 与 NumPy oracle，再写集成 RTL 和 Tcl；最终由 Codex 直接调用工具，全量比较 16×1024 个输出点。停止其他 API 后未再启动模型调用。
- 覆盖零、冲激、DC、单/双频、Nyquist、正负满幅、chirp、6 组随机数据、输入间歇、长输出反压、帧中复位及复位后首帧。
- 100 MHz 核内布局布线，2 ns 输入/输出边界延迟。PCIe、CDC、板卡引脚、音频实时采集及物理硬件不在本次验收范围。

教程仓库未发现单独 LICENSE；本次作为本地参考复刻保留来源，未再发布上游代码。FFT 算法来自 AMD IP，本次验证的是 Agent 的 IP 配置、集成、执行和结果检查能力。

本机已完成的成绩、截图和局限见 [Codex 实测成绩单](history/codex-vivado-score-2026-10-23.md)：VerilogEval 小样本 7/8，FFT 16 帧通过，100 MHz OOC 报告为正余量；实际时钟源及接口位置仍待集成验证。

研究使用 GitHub 主仓库、Exa、B站匿名 API 和公开网页；Reddit 登录接口当前不可用，讨论使用公开网页可见内容。Agent Reach 1.5.0 更新检查为最新。
