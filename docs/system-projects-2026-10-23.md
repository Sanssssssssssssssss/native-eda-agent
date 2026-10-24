**2026-10-23：4 个 Codex Agent 并行完成工程集成与验证。功能通过 4/4，100 MHz OOC 布局布线通过 4/4，单比特破坏负控正确拒绝 4/4。**

这些是开源内核的系统集成评测。Codex 完成封装、C 固件、独立参考结果、测试台、构建和调试；成绩衡量本地工程闭环，不是盲测 pass@1。

| 工程 | 功能验收 | 活动模块 / RTL 行数 |
|---|---|---:|
| RISC-V SoC | 8 个固件运行种子；40 项算法结果、8 项中断检查；23,129,899 cycles，2,603,603 次总线事务 | 4 / 2,373 |
| AXI DMA 搬运系统 | 717 个场景、4 seeds；3,064,242 字节核验、12 次传输中复位恢复 | 5 / 2,591 |
| UDP / IPv4 / ARP 网络栈 | 65 发 + 65 收；62,272 字节；61 种长度、2 类坏 IPv4 各 8 次、ARP 与空闲复位恢复 | 18 / 6,585 |
| AES-128/256 流式加速器 | 532 个块：266 加密 + 266 解密；20 组密钥、4 个复位场景、两端队列填满 | 7 / 2,290 |

RTL 行数按 XSim 实际展开的模块定义统计，含注释和参数条件分支；不含测试台和未实例化的模块。共享模块在各工程中各计一次，不能直接当成原创代码量。

| 工程 | 物理 Slice LUT / FF / RAMB36 | 建立 / 保持余量 ns | 最终仿真 / 成功实现耗时 s |
|---|---:|---:|---:|
| RISC-V SoC | 1884 / 1265 / 16 | +2.404 / +0.120 | 275.57 / 77.23 |
| AXI DMA 搬运系统 | 914 / 584 / 1 | +2.105 / +0.075 | 67.95 / 100.41 |
| UDP / IPv4 / ARP 网络栈 | 1599 / 2924 / 1 | +1.899 / +0.075 | 26.47 / 120.19 |
| AES-128/256 流式加速器 | 3195 / 2903 / 0 | +1.084 / +0.105 | 27.14 / 180.04 |

全部使用 Vivado/XSim 2020.2、Artix-7 `xc7a100tfgg676-2`、10 ns 时钟、2 ns I/O 延迟。这里展示物理 LUT 使用量，原始 LUT 单元计数因打包可能不同。耗时为最后一次成功工具运行，未包含编写和失败重跑，不能据此计算整个任务的并行加速比。

量化时分别看四项：工程功能完成率、各工程具体场景与数据量、错误检查器能否拒绝负控、相同时钟下的资源和时序。不同工程的“种子、描述符、报文、块”不合并成一个题目通过率。

保留的失败与修正：

- SoC 高停顿率运行首次超出 400 万周期看门狗；延长至 1200 万，RTL 未改，8 个种子最终通过。
- DMA 修复测试内存 guard 布置，并让复位场景等待真实 AXI R 背压；三次测试布置/覆盖失败保留，最终覆盖检查通过。
- UDP 修复测试接收器对帧头与负载独立握手的假设；随后正常与复位回归通过。
- Vivado 多次初始化读取 Tcl 文件失败，文件实际存在；并发、单跑和降线程均遇到过。峰值提交内存达到约 97%。AES 最终使用独立短目录直接 batch 启动，完整保留命令、源码快照和日志；尚不能确定异常根因。

主 Agent 汇总外，DMA 子 Agent 还只读复核了 AES 的 532 个软件向量和 UDP 的端口/计数，修正了“64 种长度”等表述。

跨聊天协作：“整理Vivado Agent并行测试”（`[local-session-id]`）参与原生工具 trace、Pi 会话终态、历史证据与复跑入口，并交接了 counter/RC 基础回归及四项系统结果独立核对。[框架与实验追踪](agent-framework-and-traces.md) · [分工与收悉记录](parallel-coordination-2026-10-23.md)。下述用量仅覆盖本聊天及三个子 Agent，未包含该协作聊天及其子 Agent。

验证范围：SoC 是 RV32IM + 64 KiB RAM + MMIO/中断；DMA 的 AXI 内存模型每通道最多一个未完成 burst；UDP 没有 MAC/PHY/FCS，接收端不校验 UDP checksum，ARP 只检查部分关键字段，复位在空闲时进行；AES 覆盖块加解密和队列，不包含认证模式或侧信道评测。四项均未上板，OOC 未固定物理时钟源及边界位置，不能作为板级时序签核。

原始证据：

- RISC-V SoC：仿真日志 (local/optional evidence; see results/catalog.json) · 仿真波形 (local/optional evidence; see results/catalog.json) · 时序 (local/optional evidence; see results/catalog.json) · 资源 (local/optional evidence; see results/catalog.json)
- AXI DMA 搬运系统：仿真日志 (local/optional evidence; see results/catalog.json) · 仿真波形 (local/optional evidence; see results/catalog.json) · 时序 (local/optional evidence; see results/catalog.json) · 资源 (local/optional evidence; see results/catalog.json)
- UDP / IPv4 / ARP 网络栈：仿真日志 (local/optional evidence; see results/catalog.json) · 仿真波形 (local/optional evidence; see results/catalog.json) · 时序 (local/optional evidence; see results/catalog.json) · 资源 (local/optional evidence; see results/catalog.json)
- AES-128/256 流式加速器：仿真日志 (local/optional evidence; see results/catalog.json) · 仿真波形 (local/optional evidence; see results/catalog.json) · 时序 (local/optional evidence; see results/catalog.json) · 资源 (local/optional evidence; see results/catalog.json)

Codex 本轮本地日志快照：输出 129,983 tokens，其中推理 36,021（已包含在输出中）；输入 21,323,439，其中缓存 20,807,296，未缓存 516,143。范围从“需要更大项目”开始，汇总主会话增量与 3 个子会话，截止各自最新计数事件；后续回复不含在该快照中。其他模型 API 调用 0，金额未推算。

结构化结果与源码哈希 (local/optional evidence; see results/catalog.json) · 逐 Agent 用量收据 (local/optional evidence; see results/catalog.json)

固定来源：[PicoRV32](https://github.com/YosysHQ/picorv32/tree/ef203c2b0a3fb793280f5114941416c425c5b461)、[verilog-axi](https://github.com/alexforencich/verilog-axi/tree/516bd5dadc3365b7f9e225d2af8fe0b8d804fe53)、[verilog-ethernet](https://github.com/alexforencich/verilog-ethernet/tree/77320a9471d19c7dd383914bc049e02d9f4f1ffb)、[secworks/aes](https://github.com/secworks/aes/tree/80dc4718e1dcbbdb4b0dd1bdb393d8f7b98981dc)。使用各自原许可证；旧项目版本用于复现，并不代表维护活跃度推荐。

复跑：在工作区执行 `python projects/system-bench/run.py soc sim`；项目名可换成 `dma`、`udp`、`aes`，阶段可换成 `impl`。AES 若仍遇 Vivado 初始化异常，按其 README 的独立 batch 复跑说明执行。

Vivado 实际窗口：SoC 布线后时序。

Vivado 实际窗口：SoC 布线后时序。 (local/optional evidence; see results/catalog.json)

Vivado 实际窗口：UDP 系统仿真波形。

Vivado 实际窗口：UDP 系统仿真波形。 (local/optional evidence; see results/catalog.json)
