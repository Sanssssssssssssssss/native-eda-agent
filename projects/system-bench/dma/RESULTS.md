DMA 系统压力测试通过 **717/717 场景**，逐字节核验 **3,064,242 bytes**；使用 4 个固定随机种子，另完成 12 次传输中复位及恢复。数据破坏负控制单独运行，checker 成功拒绝错误数据。

工程包含 AXI DMA 读引擎、写引擎、1024-byte AXIS FIFO 和 descriptor/copy 控制器，编译 5 个 RTL 模块、2732 行源码。上游核心来自固定版本的 verilog-axi / verilog-ethernet；本项目新增集成、测试及执行流程。

| 场景族 | 场景数 | 目的数据核验 bytes |
|---|---:|---:|
| 16 种对齐组合 × 24 个长度阈值 | 384 | 40,672 |
| 4 seeds × 64 个长传输，随机背压及长暂停 | 256 | 2,744,610 |
| 4 KiB 边界及不等源/目的分段 | 32 | 131,088 |
| 读/写 SLVERR、DECERR 注入 | 16 | 49,168 |
| 错误后的正常传输恢复 | 16 | 16,408 |
| 读事务、写事务、FIFO 堵塞期间复位后的恢复 | 12 | 49,536 |
| 32,760-byte 连续传输 | 1 | 32,760 |

累计 48,608 个读 burst、48,512 个写 burst，检查 AXI/AXIS 背压期间 VALID/payload 稳定性、4 KiB 边界、burst 长度、WSTRB 写入范围、WLAST、descriptor tag/length/error 和源数据完整性。10,568,464 次协议稳定性检查按时钟事件计数，不计为额外测试场景。

Vivado 2020.2 在 xc7a100tfgg676-2 上完成 100 MHz OOC 布局布线：setup slack **+2.105 ns**、hold slack **+0.075 ns**，物理 Slice LUTs **914**、FF **584**、RAMB36 **1**、DSP **0**；1215 个可布线 nets 全部完成。最终仿真 67.95 秒，物理实现 100.41 秒，负控制 34.68 秒；这些是各次执行墙钟时间，存在并发，不能相加当作总耗时。

3 次失败回归均保留：一次测试地址与 guard 重叠；两次 coverage gate 拒绝尚未发生的 AXI R 背压。修正测试布置并等待真实 RVALID && !RREADY 后完成最终通过；核心 RTL 未因此改变。XSim 的 `$fatal` 可返回进程码 0，判定使用完整日志及通过标记。

结果与逐文件 SHA-256：[assessment.json](assessment.json)。
最终仿真：process.log (local/optional evidence; see results/catalog.json)。
物理实现：timing-summary.rpt (local/optional evidence; see results/catalog.json)。
负控制：process.log (local/optional evidence; see results/catalog.json)。

复现：在 EDAAgent 根目录执行 `python projects/system-bench/generate_dma.py`、`python projects/system-bench/run.py dma sim`、`python projects/system-bench/run.py dma impl`；负控制执行 `python projects/system-bench/dma/run_negative.py`。

边界：64 KiB、单 outstanding 的 AXI 内存模型，32-bit 数据通路，非重叠 copy；错误响应仍携带确定数据。未测试真实 DDR、零长度、重叠 copy、异步复位或上板。OOC 未固定物理时钟源和接口 pin 位置，不能作为板级 100 MHz 时序签核；DRC 保留 CFGBVS-1 / RTSTAT-10 警告。其他模型 API 调用为 0。
