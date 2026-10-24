# Codex 24 题覆盖实测

2026-10-23：**原始测试规则 20/24＝83.33%；延长长测试的超时上限后，同一份 RTL 为 23/24＝95.83%。** 24 题与前一轮 8 题无重复，提前按 6 类各选 4 题；全程使用当前 Codex 和本机 XSim，额外模型 API 调用 **0 次**。

规模核对：**24 份候选 RTL 合计 327 行，每题 4～36 行**。这些是单模块功能小题；这里的“代表性”指 VerilogEval 内的结构覆盖，不能据此判断复杂 Vivado 工程能力。百万个样本是仿真比较次数，不是模型任务数或推理次数。

| 类别 | 代表任务 | 原始规则 | 延长测试后 |
|---|---|---:|---:|
| 组合与位运算 | 256 路总线选择、255 位 population count、优先编码、K-map | 3/4 | 3/4 |
| 寄存器与边沿 | 异步复位、下降沿捕获、字节使能、双边沿功能 | 4/4 | 4/4 |
| 计数与定时 | 模 1000、饱和计数、倒计时、12 小时 BCD 时钟 | 3/4 | 4/4 |
| 移位与迭代逻辑 | LFSR、旋转、算术移位、512 单元 Rule 110 | 3/4 | 4/4 |
| 状态控制 | one-hot、六状态 FSM、Lemmings、串行配置定时器 | 3/4 | 4/4 |
| 协议与分支预测 | HDLC、串口接收、gshare、PS/2 组包 | 4/4 | 4/4 |

计分为 **通过题数 / 24**。每题必须仿真完成、未超时、有检查样本且 mismatch 为零。类别等权，不按仿真样本数量加权。

## 两个成绩为何不同

首批运行器报告 22/24，但最终审计发现它漏判了 `TIMEOUT`。上游判分脚本 (local/optional evidence; see results/catalog.json)明确将超时记为失败，因此重新判为 **20/24**。运行器已经修正，两项回归测试通过；前一轮 7/8 也用新规则复核，成绩不变。

BCD 时钟、LFSR、复杂定时器的激励需要超过 100,000 个时钟周期，但上游 TB 的统一 watchdog 在 100,000 周期就终止。例如 LFSR 单个阶段就要求 200,000 周期。另有定时器 TB 的 `default_nettype none` 泄漏到候选模块，使 XSim 首批编译失败；隔离该编译指令后，原候选可以运行，但同样触发原 watchdog。

单独复测这 3 题：仅将 watchdog 从 `1,000,000 ps` 延长到 `10,000,000 ps`，保持全部功能激励、比较逻辑与候选 RTL 不变。三题全部跑到正常结束且零不匹配，组合后为 **23/24**。这是延长测试后的本地结果，保留原始规则的 20/24 主成绩。

## 剩余一题：题面和参考冲突

`Prob093_ece241_2014_q3`：题面 K-map (local/optional evidence; see results/catalog.json) 在 `c=d=1、a=1、b=0` 时要求输出 **1**；参考实现 (local/optional evidence; see results/catalog.json) `mux_in[2] = ~d` 给出 **0**。候选输出 1。额外穷举 4 种 `c,d`、全部 16 个表格单元，确认只有这一处参考与题面不一致。

该题在按上游参考计分时仍保留失败，不把本地规格诊断改算成 24/24。穷举证据 (local/optional evidence; see results/catalog.json)保留了每行期望、候选和参考输出。

## 证据、用量和边界

- 扩展后共比较 **1,028,806 个样本**；首批工具耗时 **255.58 秒**，3 题完整复测 **38.80 秒**。编译隔离诊断另耗时 12.60 秒；以上不含 Codex 思考、编写和报告整理时间。
- 24 份候选在首轮测试前冻结，所有复测候选 SHA-256 一致，RTL 修改 **0 处**。[题集](../projects/verilogeval-24/selection.json)、[冻结记录](../projects/verilogeval-24/initial-candidates.json)、逐题成绩 (local/optional evidence; see results/catalog.json)、机器可读成绩 (local/optional evidence; see results/catalog.json)。
- 延长测试的原始记录 (local/optional evidence; see results/catalog.json)、[复跑命令](../projects/verilogeval-24/README.md)。原始误计分日志保留，并在汇总中明确纠正。
- 本轮额外模型 API 调用 **0 次**。后续从本地 Codex 会话日志查得，这一轮输出 **30,000 tokens**（其中推理 **9,940**）；输入 **2,704,286**，其中缓存 **2,633,984**、非缓存 **70,302**。输入包含反复提供的会话历史，推理数已包含在输出中，不能重复相加。用量取证记录 (local/optional evidence; see results/catalog.json)保存任务前后计数器差值；费用未知。这更正了此前“当前 Codex 用量无法统计”的表述。

这是同一会话中的定向覆盖题集，使用 XSim 2020.2 适配运行器；不是完整 156 题成绩、随机总体估计或模型排行榜 pass@1。它测 RTL 功能，尚不覆盖综合、PPA、形式验证和上板。此前 FFT 工程结果见[工程成绩单](codex-vivado-score-2026-10-23.md)。
