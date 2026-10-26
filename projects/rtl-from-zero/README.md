# 从端口空壳设计两项 RTL

原始 `dma/` 和 `packet-switch/` 中的 DUT 是接口空壳，用于新建独立 Agent 任务。固定规格、testbench 和约束位于同目录。`submitted/` 保存本次 Pi 写出的最终文件，与候选原件逐字节核对；DMA 固定 OOC 验收通过，交换机功能失败。

| 工程 | 固定规格 | 起点 | Pi 最终候选 |
|---|---|---|---|
| AXI4 DMA | [SPEC](dma/SPEC.md) | [接口](dma/z_dma.sv) | [325 行 RTL](submitted/dma/z_dma.sv) |
| 4×4 包交换机 | [SPEC](packet-switch/SPEC.md) | [接口](packet-switch/z_packet_switch.sv) | [307 行 RTL，未通过](submitted/packet-switch/z_packet_switch.sv) |

[成绩与限制](../../docs/from-zero-rtl-2026-10-27.md) · [输入与候选哈希](../../release/summary-from-zero-rtl.json)。本批模型只写候选 DUT；测试由独立 Codex 子 Agent 编写、审查并提前冻结。规格和 checker 可见，不按盲测评分。

准备新任务只创建隔离候选，不调用模型或 Vivado：

```powershell
node src/agent.mjs task prepare examples/verification/from-zero-dma.json
node src/agent.mjs task prepare examples/verification/from-zero-packet-switch.json
```

准备后按 [任务生命周期](../../docs/agent-lifecycle.md) 在原生 Pi / 工作台执行，分别限制 6 轮、24 次验证调用。新实验不得读取 `submitted/` 作为生成参考；该约束需要另外审计，当前仓库没有 OS 级读取隔离。

验收已保存的提交会真实启动 XSim/Vivado，不调用模型 API：

```powershell
node scripts/workflow.mjs run examples/workflows/from-zero-dma-submitted.json
node scripts/workflow.mjs run examples/workflows/from-zero-packet-switch-submitted.json
```

复跑规格仅将 DUT 路径切换到公开候选，保留原 testbench、checks、器件、10 ns 时钟和 OOC 约束。交换机应保留功能失败；不要通过放宽 watchdog、测试或验收条件变成通过。空壳负控可以使用没有 `-submitted` 后缀的 workflow。

需本机 Vivado/XSim 2020.2，`EDA_VIVADO_BIN` 指向其 bin 目录。独立模块使用 A7-100T OOC 条件，未完成具体开发板引脚分配或上板验证。
