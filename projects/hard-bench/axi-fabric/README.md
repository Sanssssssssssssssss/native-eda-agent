# AXI4 3 × 3 并发互连系统

**功能与 100 MHz OOC 物理实现均通过：4 个固定种子、4,656 个 burst、100,992 字节读数据核验。** 主回归耗时 35.39 秒。一位数据损坏负控已触发指定 Fatal；短波形回归已通过并生成 4.44 MB WDB。机器结果、源 SHA-256、原始日志位置见 [result.json](result.json)。

物理实现耗时 239.59 秒：setup slack **+2.109 ns**、hold slack **+0.058 ns**；使用 **2,008 个物理 Slice LUT、2,014 FF、8 RAMB36**。3,155/3,155 条网络完成布线，布线错误 0。约束为 `xc7a100tfgg676-2`、10 ns 时钟、2 ns 输入/输出延迟。冻结综合源与当前源哈希一致；回执另行保留汇总辅助脚本的变化。详见 latest-impl.json (local/optional evidence; see results/catalog.json)。

三个 master 同时连接两个 16 KiB RAM 和一个 SLVERR 目标；未映射地址返回 DECERR。32-bit 数据、16-bit 地址、master ID 4-bit，目标 ID 6-bit 携带 master 路由标识。五个 AXI 通道分别经过目标侧随机延迟缓冲，master 侧独立随机发起和施加响应背压。

| 实测量 | 结果 |
|---|---:|
| 写 / 读 burst | 2,328 / 2,328 |
| 每 master 峰值 outstanding：写 / 读 / 合计 | 4 / 5 / 8 |
| 全系统峰值 outstanding | 18 |
| 同写 ID / 同读 ID 峰值 outstanding | 2 / 2 |
| 同周期至少 2 / 全部 3 master 完成握手 | 15,607 / 3,846 周期 |
| 同周期读写数据握手 | 11,806 周期 |
| 不同 ID 的写 / 读乱序完成 | 138 / 212 |
| SLVERR 写 / 读；DECERR 写 / 读 | 各 384 |
| 合法突发恰好结束于 4 KiB 边界 | 339 |
| stall 稳定性检查 / 响应 VALID 先行关系检查 | 658,158 / 79,153 |
| 实际目标 WLAST 检查 | 31,536 |
| WVALID 在对应 AWVALID 尚未出现时已有效 | 90 周期 |

种子为 `c001cafe`、`5eed1234`、`deadbeef`、`13579bdf`。每个种子先初始化 RAM，再同时跑不同长度、部分 WSTRB、正常/错误地址的读写，随后读回写区域，最后执行跨 master 的共享区域写完成屏障与 24 笔依赖读取。独立 byte scoreboard 从 master 握手记录写入，按每 ID 事务队列核对读数据、响应、ID 和 RLAST。检查覆盖门未满足时仍判失败。4,656 是事务数，此目录是 **1 个集成系统测试**。

测试实际发现并修复两个当前版本问题：DECERR B 可以早于对应 AW/WLAST，以及 DECERR 读请求绕过同 ID 目的地顺序跟踪。只有外部 B guard 的中间版本还产生了响应仲裁与写数据之间的等待环。最终使用本地 addr/wr overlay 加 AW/W completion guard：DECERR 参与同 ID 事务跟踪，写错误响应在 drop WLAST 后才进入 B 仲裁。原 vendor 未修改；差异见 upstream-fix.patch (local/optional evidence; see results/catalog.json)。这些修改按当前组合验证，不承诺单独补丁适用所有参数与时序。每次失败及当时源快照均保留在结果的 `attempt_history` / 原生 artifact `inputs/` 中。

上游为 `alexforencich/verilog-axi` commit `516bd5dadc3365b7f9e225d2af8fe0b8d804fe53`。综合输入共 4,365 行，包含大量上游 RTL。`sources.json`、`impl.json`、`implement.tcl` 提供 100 MHz、`xc7a100tfgg676-2` 的 OOC 实现输入。

复现：在工作区根目录运行 `python projects/hard-bench/axi-fabric/generate.py`，然后运行 `run.py sim`、`run.py negative` 或 `run.py trace`（`run.py` 使用此目录的完整路径）。`collect_results.py` 仅汇总证据。负控翻转一个观测读数据位，必须产生指定 `Fatal: FABRIC_READ_DATA`，不能出现正式 PASS；短 trace 仅用于波形，不增加测试分数。所有执行只使用本地 XSim/Vivado，其他模型 API 调用 0。

边界：仅对齐 32-bit INCR、1–64 beat；未覆盖 FIXED/WRAP、窄传输、独占、USER/QoS。并发读写使用不同地址区，共享读在写完成后发起，不声称覆盖同地址竞争。BID/BRESP 完全相同的两笔响应无法凭 AXI B 通道单独区分互换。只在种子间复位，未测 fabric 在途复位；无板卡、形式证明或外部榜单排名。
# 2026-10-26 protocol checker

`tb_axi_fabric_protocol.sv` extends the historical transaction checker with VALID/payload hold assertions on all 15 internal delay outputs. Every channel must observe a stalled transfer. A VALID-withdrawal mutation is rejected; correct RTL passes 4,656 bursts. The original checker and historical results below retain their original protocol. Use `sim-protocol.json` or `examples/workflows/axi-fabric-protocol-ooc.json` for a new run; this does not waive physical DRC warnings. See [stability evidence](../../../docs/stability-2026-10-26.md).
