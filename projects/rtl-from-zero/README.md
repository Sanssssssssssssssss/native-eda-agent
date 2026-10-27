# 从端口空壳设计两项 RTL

通过的续修版本位于 `repaired/`，两项均经原生 Pi 会话和固定 verifier 完整验收。[续修报告](../../docs/rtl-repair-2026-10-27.md)保存全部限制与用量。复跑使用 `examples/workflows/from-zero-dma-repaired.json` 和 `examples/workflows/from-zero-packet-switch-repaired.json`，会执行真实 XSim/Vivado。

原始 `dma/` 和 `packet-switch/` 中的 DUT 是接口空壳，用于新建独立 Agent 任务。固定规格、testbench 和约束位于同目录。`submitted/` 保存首批 Pi 候选，与当时的原件逐字节核对；首批结果为 DMA 固定 OOC 验收通过、交换机功能失败。

| 工程 | 固定规格 | 起点 | 通过版本 | 首批 Pi 候选 |
|---|---|---|---|---|
| AXI4 DMA | [SPEC](dma/SPEC.md) | [接口](dma/z_dma.sv) | [325 行 RTL](repaired/dma/z_dma.sv) | [首批 RTL](submitted/dma/z_dma.sv) |
| 4×4 包交换机 | [SPEC](packet-switch/SPEC.md) | [接口](packet-switch/z_packet_switch.sv) | [395 行 RTL](repaired/packet-switch/z_packet_switch.sv) | [307 行 RTL，未通过](submitted/packet-switch/z_packet_switch.sv) |

[成绩与限制](../../docs/from-zero-rtl-2026-10-27.md) · [输入与候选哈希](../../release/summary-from-zero-rtl.json)。本批模型只写候选 DUT；测试由独立 Codex 子 Agent 编写、审查并提前冻结。规格和 checker 可见，不按盲测评分。

复跑通过版本会执行真实 XSim/Vivado，不调用模型 API：

```powershell
node scripts/workflow.mjs run examples/workflows/from-zero-dma-repaired.json
node scripts/workflow.mjs run examples/workflows/from-zero-packet-switch-repaired.json
```

准备新任务只创建隔离候选，不调用模型或 Vivado：

```powershell
node src/agent.mjs task prepare examples/verification/from-zero-dma.json
node src/agent.mjs task prepare examples/verification/from-zero-packet-switch.json
```

准备后按 [任务生命周期](../../docs/agent-lifecycle.md) 在原生 Pi / 工作台执行，分别限制 6 轮、24 次验证调用。新实验不得读取 `submitted/` 或 `repaired/` 作为生成参考；该约束需要另外审计，当前仓库没有 OS 级读取隔离。

复跑首批提交可复核历史失败，同样会执行真实 XSim/Vivado：

```powershell
node scripts/workflow.mjs run examples/workflows/from-zero-dma-submitted.json
node scripts/workflow.mjs run examples/workflows/from-zero-packet-switch-submitted.json
```

两组复跑规格仅将 DUT 路径切换到对应候选，保留原 testbench、checks、器件、10 ns 时钟和 OOC 约束。首批交换机仍应功能失败，固定测试和 watchdog 保持不变。空壳负控使用没有 `-submitted` 或 `-repaired` 后缀的 workflow。

需本机 Vivado/XSim 2020.2，`EDA_VIVADO_BIN` 指向其 bin 目录。独立模块使用 A7-100T OOC 条件，未完成具体开发板引脚分配或上板验证。
