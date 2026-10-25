# Agent 基座验收（2026-10-23，新加坡时间）

已接通 Pi 原生扩展、9 个统一 MCP 工具、状态与资源调度、hooks、4 个项目技能、来源规则、分类 benchmark、独立验收及可检查的 trace。最终框架验收 **62 项 Node + 12 项 Python 全部通过**；真实 MCP → XSim 计数器和 LTspice RC 两项分析通过。Benchmark 中的真实失败仍保留，见下表。

使用入口：[Agent 实验基座](../agent-foundation.md)。机器结果索引：result.json (local/optional evidence; see results/catalog.json)。

## 已交付

| 部分 | 内容与证据 |
|---|---|
| 测试目录 | **77 个入口、57 个 family、14 类、5 层级**；24 个生成 RTL 变体、32 道独立 VerilogEval 题；[目录说明](../benchmark-catalog.md) |
| 状态与并行 | XSim 2、Vivado 1、LTspice 1；跨进程 FIFO、超时/取消、崩溃恢复、持久化状态；17 项相关测试通过 |
| Agent / MCP | Pi TUI 与 SDK 共享 9 个工具；官方 MCP 客户端握手、schema 拒绝、知识查询和真实 XSim 已测；现有 LTspice 桥接 18 工具保持接通 |
| 知识与技能 | **21 个官方来源、36 条规则、11 项工具状态、4 个技能**；带适用版本和证据强度；[来源与边界](../fpga-knowledge-and-tools.md) |
| Trace | 参数、输入/依赖哈希、快照、父子 trace/span、hooks、排队/进程耗时、PID/退出码、stdout/stderr、验收结果；[检查与重放](../trace-storage.md) |
| 迭代 | plan → baseline → candidate → compare；失败加入回归；本机验证脚本与 Windows CI 配置。远端 CI 尚未执行 |

分类覆盖组合/时序逻辑、FSM、协议、总线、存储、算术、DSP、系统、模拟电路、工具错误、超时、trace 和复现。5 个层级为 smoke、light、system、implementation、external；两项 external 为明确阻塞的占位入口，未下载数据或计入成绩。

24 个正常生成 RTL 变体来自 12 个 family × 2 位宽，每个 40 个确定性参考向量，共 960 个。参数变体和向量数不充当独立题目数。规则库用于可追溯检索，不能代替 lint、formal 或板卡验证。

## 实跑结果

| 实验 | 结果 | 原始回执 |
|---|---|---|
| 61 项 light，16 分 38.742 秒 | **51 PASS、1 FAIL、6 TIMEOUT、2 预期拒绝、1 预期超时** | REPORT (local/optional evidence; see results/catalog.json) / 逐项审计 (local/optional evidence; see results/catalog.json) |
| FIFO 修复后补跑 3 项，35.998 秒 | **3/3 PASS**；累计排队 19 ms | REPORT (local/optional evidence; see results/catalog.json) / 审计 (local/optional evidence; see results/catalog.json) |
| gen-adder-w4 同输入复跑 | **1 项可比，PASS → PASS，0 退步，无警告**；其余 60 项未选择 | compare (local/optional evidence; see results/catalog.json) |
| 最终平台验收 | **62/62 Node、12/12 Python**；MCP 计数器 321 次检查通过 | validation (local/optional evidence; see results/catalog.json) / 完整测试日志 (local/optional evidence; see results/catalog.json) |
| 最终 RC AC / transient，4.503 秒 | **2/2 PASS**，独立公式验收 | REPORT (local/optional evidence; see results/catalog.json) |
| counter 实现，首跑 / 串行复跑 | **两次 FAIL**，均在综合阶段报文件读取错误 | 首跑日志 (local/optional evidence; see results/catalog.json) / 复跑日志 (local/optional evidence; see results/catalog.json) |

将 3 项显式补跑结果合入“每题最新结果”视图后，是 **54 PASS、2 预期拒绝、1 预期超时、1 FAIL、3 TIMEOUT**。原 61 项批次成绩保持原样。24 个生成 RTL 变体现均通过；32 道 VerilogEval 为 28 PASS、1 FAIL、3 TIMEOUT。这些是已有设计回归，模型 API 调用为 0，不是模型盲测代码生成分数。

原 6 项 TIMEOUT 中，gen-adder-w8、gen-mux-w4、gen-fir-w4 仅在排队，实际子进程数为 0。修复 FIFO 后三项独立补跑通过。case 的 wall deadline 包括排队，报告已分别记录 queue/process；并行用例耗时之和不能当作整批墙钟时间。

未解决的结果：

- `ve-Prob093_ece241_2014_q3`：60 个样本中 11 个不匹配，保留 FAIL。
- `ve-Prob141_count_clock`、`ve-Prob082_lfsr32`、`ve-Prob156_review2015_fancytimer`：触发上游 watchdog，未放宽测试或超时来改分。
- counter 实现首跑无法读取安装目录的 `unimacro_verilog.tcl`；串行复跑无法读取该次 `.Xil/.../realtime/counter.tcl`。两次均取得 Synthesis license，报错文件事后均存在。复跑排队仅 6 ms，设计/Tcl 哈希无变化；共同根因尚未确认，不能认定是队列或内存问题。

61 项、比较复跑和 FIFO 补跑采用 catalog `2026-10-23.1`。最终 `2026-10-23.2` 只修正两道题的分类，校验与单测通过；最终 RC 和 counter 实现复跑使用 `.2`，没有声称把全目录在 `.2` 再跑了一遍。system/implementation 层除上述 counter 外未在本轮目录批次重跑，历史系统成绩见各自报告。

## 证据、体积与使用量

最终平台验收冻结 46 个输入，输入无漂移，快照及内容对象完整性通过。真实 MCP 计数器的 trace 也通过当前文件核对，重放前检 `ready=true`。最终 trace 检查 (local/optional evidence; see results/catalog.json) / 开发过程与失败修复 (local/optional evidence; see results/catalog.json)。

本轮选定 7 个 benchmark 批次及其真实工具子运行，按硬链接去重后 **31.32 MiB**，其中波形文件约 **0.49 MiB**；新增 MCP 依赖 8 包、约 **20.37 MiB**。当前 `src/benchmarks/knowledge/.pi/skills/.eda/tests` 范围合计约 **335.6 KiB**，这是这些完整文件的体积，非增量。前述 benchmark 数字不含平台验收、单测夹具或另一聊天的大型工程产物。精确范围与字节数 (local/optional evidence; see results/catalog.json)。

生成用例按需生成，默认不请求完整波形，快照按 SHA-256 内容去重。历史日志与波形保留；清理命令仅生成候选计划。全工作区历史波形约 2.74 GB，不属于本轮轻量 benchmark 的新增体积。

项目 benchmark 的模型 API 调用数为 **0**；外层 Codex 用量单独保存于 会话计数快照 (local/optional evidence; see results/catalog.json) 和 汇总口径 (local/optional evidence; see results/catalog.json)。这是截至采样时的本地计数，费用未知，不含此后的最终回复，缓存输入和推理输出不重复相加。

尚未取得板卡实测、外部 formal、远端 CI、重新启用模型后的端到端/盲测成绩。静态依赖发现不能覆盖任意动态 Tcl；商业工具、许可证和操作系统未封装，重放不承诺跨机器位级一致。后续先用保留的失败入口定位问题，再以相同验收建立 candidate，按 compare 和原始证据决定是否采用。
