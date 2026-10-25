# 三项更复杂系统的实跑成绩

**新增 3 项系统集成，最终功能 3/3、故障检出负控 3/3、布局布线与时序 3/3 通过。** 当前 Codex 与 3 个子 Agent 并行完成开发、调试和复核，其他模型 API 调用为 0。前四项工程另有[原报告](system-projects-2026-10-23.md)；本轮按三个系统计数。

| 系统 | 实际集成与验证 | 最终功能耗时 |
|---|---|---:|
| [AXI 3×3 互连](../../projects/hard-bench/axi-fabric/README.md) | 3 master、2 个 RAM、错误目标；4 seeds、4,656 bursts、100,992 字节读数据核验；峰值 18 笔在途，同写/读 ID 深度均为 2 | 35.39 s |
| [三时钟 Ethernet 系统](../../projects/hard-bench/ethernet-cdc/README.md) | GMII→MAC→异步 FIFO→ARP/IP/UDP→echo→GMII；两组时钟下 562 次有效回显、566 帧、402,046 字节完整报文比较；48 次坏包丢弃及恢复 | 68.67 + 62.79 s |
| [CPU + 加密 DMA SoC](../../projects/hard-bench/crypto-soc/README.md) | RV32IM 运行 C 固件，通过描述符、MMIO 和 IRQ 控制 AES-128/256 CTR DMA；共享 64 KiB RAM；3 seeds、42 个正确描述符、26,592 字节密文、21 次错误恢复 | 255.34 s |

耗时含编译和展开。种子、事务、字节是项目内部覆盖量；Ethernet 两组时钟重放同一向量集。短波形回放及暖复位补测不增加主回归数量。

| Vivado 2020.2 / xc7a100tfgg676-2 | 时钟目标 | Setup / Hold 余量 | 物理 Slice LUT / FF | RAMB36 / RAMB18 | 实现耗时 |
|---|---|---|---:|---:|---:|
| AXI fabric | 100 MHz | +2.109 / +0.058 ns | 2,008 / 2,014 | 8 / 0 | 239.59 s |
| Ethernet CDC | 100 / 125 / 125 MHz | +2.510 / +0.073 ns | 1,896 / 2,964 | 7 / 2 | 161.20 s |
| Crypto SoC | 100 MHz | +0.518 / +0.096 ns | 5,110 / 4,866 | 16 / 0 | 163.08 s |

三项所有可布线网络均完成布线，routing errors 为 0；实际综合 RTL 的 SHA-256 与最终仿真输入、实现输入一致。资源取 utilization 报告的物理 LUT，避免把 LUT primitive 数与共享物理 LUT 混用。实现逐项调度，开发和仿真并行。

量化采用四个独立验收条件：

1. **功能**：有且仅有正式 PASS 标记，退出码正常，无 Fatal/超时，且覆盖门满足。XSim 遇到 `$fatal` 仍可能返回 0，退出码本身不能证明通过。
2. **检查器有效性**：AXI 观测数据、Ethernet 预期 FCS、Crypto 实际 RAM 密文各翻转 1 bit，三项均触发对应的指定 Fatal，均无 PASS 标记。
3. **物理实现**：完成 route，所有可布线网络布通，无 routing error，输入 RTL 哈希一致。
4. **时序**：固定目标时钟下 setup 和 hold slack 均非负，同时检查缺失时钟、内部未约束端点及 CDC 报告。

这是可见测试下经调试后的集成成绩，采用固定版本的公开 IP，不代表官方 benchmark 排名、盲测 pass@1 或全部 RTL 从零生成。汇总脚本、原始回执和输入哈希见机器结果 (local/optional evidence; see results/catalog.json)。

本轮确实发现并修复了问题。AXI 的 pinned crossbar 存在当前配置下 DECERR 响应提前和同 ID 顺序跟踪遗漏；只加外部响应 guard 的中间版本还产生了等待环。最终在本地 overlay 修正地址跟踪和错误写响应时机，并配合 AW/W completion guard，4 个种子全部通过。原 vendor 保持干净，补丁及 8 次失败/诊断尝试见[AXI 回执](../../projects/hard-bench/axi-fabric/result.json)。补丁按当前组合验证，未声称单独适配所有参数。

Ethernet 增加 IPv4 长度检查及整帧丢弃缓冲；最初“加背压”的刺激没有真正压满 FIFO，覆盖门拒绝通过，最终实测 RX AXIS 停顿 2,071 / 3,841 周期。Crypto 累计运行 11,919,085 周期，CPU/DMA 同时 pending 161,407 周期；独立 TB 检查前六类非法任务实际 DMA 写入为 0，描述符自环达到上限时实际写入 512 字节后报错。主回归、保留 RAM 的暖复位补测及错误后恢复均通过。

边界需要保留：全部为 **OOC 核内实现**，缺少顶层时钟源和接口实际位置，Vivado 的 `HD.CLK_SRC` / `HD.PARTPIN_LOCS` 警告尚在，余量不等于板级签核。Ethernet CDC 有 **0 Critical / 34 Warning**，已按 Gray 指针、稳定总线握手、独立状态位及复位链逐项复核，4 项 bus-skew 检查全通过；外部异步 reset 是唯一无 input delay 的端口，详见 [CDC 审查](../../projects/hard-bench/ethernet-cdc/CDC-REVIEW.md)。这不构成形式化 CDC 或亚稳态 MTBF 证明。

AXI 覆盖对齐 INCR、1–64 beat，未覆盖 FIXED/WRAP、窄传输或在途复位；同地址并发读写竞争未测。Ethernet 无 PHY/板卡，未验证 RX UDP checksum；非 125 MHz 的 GMII 仿真用于 CDC 压力，不是实测速率。Crypto 使用 native 总线，无缓存、操作系统或认证加密。所有项目均未上板。

Vivado 实际三时钟波形 (local/optional evidence; see results/catalog.json)

截图来自本次 XSim 的真实 WDB，显示 150.000–150.200 μs 的三组时钟和 GMII 发送数据。实际布局与时序截图 (local/optional evidence; see results/catalog.json)、截图来源与哈希 (local/optional evidence; see results/catalog.json)均已保留。

本轮用量见Codex 计数快照 (local/optional evidence; see results/catalog.json)。截至新加坡时间 03:03:50：输出 **168,572 tokens**，未缓存输入 **685,660**，缓存输入 **30,835,200**。从本条“再来难的”请求起，对主会话和三个复用子会话分别扣除基线，不含另一框架聊天。缓存数包含多轮重复上下文，不能当作新增内容；reasoning 已包含在输出中。记录是本地计数器快照，不是账单，后续记录以 JSON 为准。

复核入口：

```powershell
python projects/hard-bench/collect_results.py
python projects/hard-bench/collect_usage.py
# 重跑实现（每次生成独立 artifact）
python projects/hard-bench/direct_impl.py axi-fabric
```

各项目 README 给出仿真、负控和固件生成命令。另一子 Agent 的复核 (local/optional evidence; see results/catalog.json)交叉检查了 AXI/Crypto 原始日志、负控和冻结 TB。另一协作聊天负责基础回归及 trace/调度框架，记录见[框架与 trace](../agent-framework-and-traces.md)、[分工](parallel-coordination-2026-10-23.md)。并行期间框架文件和部分辅助脚本发生过变化，trace 保留这些 drift；本轮通过的是逐项核对后的设计 RTL，不声称所有运行环境文件完全一致。
