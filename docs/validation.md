# 本机验证记录

这是 2026-10-22 的历史记录，包含当时已授权的 Pi 模型用量。当前模型 API 已停用；版本验收见 [发布回执](../release/README.md)，历史成绩按功能见 [结果目录](results.md)。

日期：2026-10-22，Asia/Singapore。原生入口 `eda.ps1` → `src/agent.mjs` → Pi SDK 1.3.0；模型 `deepseek/deepseek-flash`。最终原生 Agent 流程完成且未触发运行上限。

| 项目 | 本机结果 | 范围 |
|---|---|---|
| XSim 2020.2 | 321 次检查通过，1 次溢出、7 次保持、3 次复位 | 计数器 RTL 仿真 |
| Vivado 2020.2 | 100 MHz，setup +5.958 ns、hold +0.140 ns；8 个 FF、9 个 LUT 单元 | out-of-context 核内综合 / 布局布线；LUT 单元计数不等同于 Slice LUT 占用 |
| 时序完整性 | 无未约束内部端点、无缺失输入 / 输出延迟 | `check-timing.rpt` |
| LTspice 26.1.1 AC | fc = 1591.54950775 Hz；1 kHz 增益 = 0.846733015964 | 原生批处理执行，真实 `.log` 读数 |
| LTspice 瞬态 | 100 µs 时 0.632117556958 V；1 ms 时 0.999954581261 V | 与 RC 解析解比较，四项相对误差均低于固定 0.2% 阈值 |
| 官方 LTspice MCP | 18 个工具连接成功，早期运行已通过 MCP 获得仿真与数字波形 | 不是仅配置文件检查；原始返回保存在 `artifacts/ltspice-mcp/` |
| 运行上限 | `--max-turns 1` 实测在读取文件后的下一模型轮次停止 | 独立的预期中断测试，不计作主流程失败 |
| 日志解析回归 | 真实 dB 格式、线性格式通过；故意错误的增益被拒绝 | `npm test` |

最终 Agent 的验收 JSON：`acceptance.json` (local/optional evidence; see results/catalog.json)。工具调用事件 (local/optional evidence; see results/catalog.json)、Agent 回答 (local/optional evidence; see results/catalog.json)、版本 / 哈希与核查回执 (local/optional evidence; see results/catalog.json)均已保存。合并模拟日志与两个原始日志在统一换行符后逐字相符。

在 Agent 验收之前，还独立执行了 `eda verify`，三部分全部通过：工具层回执 (local/optional evidence; see results/catalog.json)。

## 保留的失败与限制

- 原 `examples/digital/build.tcl` 自动 IO 分配的板级 setup slack 为 **-2.214 ns**。失败未被覆盖；核内验收不替代该板级结果。还需要实际板卡的引脚约束与外部时序资料。
- 首次 XSim 因设计缺少 `timescale` 失败，Pi 根据日志修复设计后重跑通过；testbench 没有被放宽。
- LTspice 官方桥接首次启动遇到初始化窗口。当前已完成初始化；原生批处理复用已初始化设置，单任务有 120 秒上限。
- 一份网表同时包含 AC 和 transient 会被 LTspice 拒绝，因此分别使用 `rc_ac.cir` / `rc_tran.cir`。
- 早期解析器不支持新版 `.meas` 的 dB / 相位表示；现已修正并保留错误数据拒绝检查。
- 未生成 bitstream，未编程 FPGA，未进行板上或仪器实测。AMD Ross 独立 MCP 程序仍未取得，当前 Vivado 接口是原生 Tcl 批处理。

首次长任务完整结果见原始报告 (local/optional evidence; see results/catalog.json)。该报告中的“未安装软件”等陈述只描述当时的 Pi 子进程任务范围；整个搭建过程已在本工作区安装 Pi 依赖、解包 LTspice，LTspice 初始化也会写入 Windows 用户设置 / 库目录。

## 模型用量

最终成功的原生 SDK 验收：9 轮模型响应，输入 8,794、输出 3,745、缓存读取 66,432，共 78,971 tokens；Pi 目录价格估算 **US$0.00753**。用量回执 (local/optional evidence; see results/catalog.json)

本工作区从初次接入到最终验收的 Pi 记录合计：104 个带用量回执的响应，输入 78,892、输出 58,005、缓存读取 5,342,080，共 5,478,977 tokens；估算 **US$0.12533**。其中包含首次长任务、失败修复与上限测试。费用按 Pi 模型目录估算，不是服务商账单，也不包含外层 Codex 会话。汇总明细 (local/optional evidence; see results/catalog.json)
