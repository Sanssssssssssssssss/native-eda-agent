# VerilogEval 24 题覆盖评测

从固定的 VerilogEval v2 提交 `c498220d0a52248f8e3fdffe279075215bde2da6` 定向选择 6 类各 4 题，与上一轮 8 题无重复。题单在实现前固定；24 份候选在查看测试结果前全部冻结。当前 Codex 依据题目作答，XSim 在本机执行，额外模型 API 调用为 0。

已完成：原始规则 **20/24**；延长 3 道长测试后、RTL 不变时 **23/24**。[完整成绩与计分审计](../../docs/history/codex-verilogeval-24-2026-10-23.md)。

| 类别 | 覆盖任务 |
|---|---|
| 组合与位运算 | 256 路总线选择、255 位 population count、优先编码、K-map 分解 |
| 寄存器与边沿 | 异步复位、下降沿锁存、字节使能、双边沿功能 |
| 计数与定时 | 模 1000 计数、饱和计数、可重载倒计时、12 小时 BCD 时钟 |
| 移位与迭代逻辑 | 32 位 LFSR、100 位旋转、64 位算术移位、512 单元 Rule 110 |
| 状态控制 | one-hot 转移逻辑、六状态 FSM、Lemmings 行为、串行配置定时器 |
| 协议与分支预测 | HDLC、串口字节接收、gshare 预测器、PS/2 三字节组包 |

```powershell
cd ${WORKSPACE}
node scripts/verilogeval-mini.mjs --project projects/verilogeval-24

# 扩展测试时间上限，属于不同评测设置
node scripts/verilogeval-mini.mjs --project projects/verilogeval-24 --test-timeout-ps 10000000
```

运行目录、逐题日志和总成绩由命令输出给出。`selection.json` 保存题号、类别和 prompt 哈希；`initial-candidates.json` 保存首次候选哈希及规格假设；每次运行保留候选、题目和适配后的 TB/参考副本。原始上游文件保持不变。

每题必须真实完成仿真、没有 TIMEOUT、检查样本数大于零且 mismatch 为零才记通过。工具失败、超时和功能失败均保留在 24 题分母中，修复结果另算。每类通过率与总体通过率同时报告，样本比较次数仅作工作量指标，不当作独立题目数。`node --test scripts/verilogeval-verdict.test.mjs` 检查真实超时误计分的回归案例。

这是有意覆盖不同结构的小样本，不是随机总体估计。所有题在同一 Codex 会话内作答，不能当作独立会话的模型排行榜 pass@1。使用 XSim 2020.2 适配运行器：参考副本补时间单位，TB 的两个 wire 声明前移，候选前恢复默认 nettype；不改功能激励和比较逻辑。扩展模式另外延长 watchdog 并在结果中记录。该轮只评估功能，未做综合、时序、形式证明或上板。
