# Vivado 数字工具扩展验收 · 2026-10-24

本地共享工具从 **9 项增至 15 项**，新增器件/IP 查询、综合、布局布线、报告、网表对象和时序路径工具。XSim 增加混合语言、头文件、宏、参数、库、plusargs、随机种子与完成判定。当前 Codex 和 Pi 共用这些接口；本轮额外模型 API 调用 **0**。

最终工具集成检查 **12/12 通过**，耗时 **231.5 秒**；离线检查为 **68 个 Node 测试、12 个 Python 测试及测量解析检查通过**。12 项是工具集成检查数量，独立设计覆盖仍沿用现有工程口径。

| 对象 | 本轮执行 | 实测结果 |
|---|---|---|
| AXI 3×3 互连 | 功能仿真 → 综合 → OOC 布局布线 | 4 seeds；4,656 个读写 burst；100,992 字节读取校验；658,158 次协议检查；最大 18 个 outstanding |
| AXI 时序与资源 | Artix-7 `xc7a100tfgg676-2`，10 ns 时钟、2 ns IO 延迟 | Setup **+2.393 ns**，hold **+0.058 ns**；LUT **2,018**、FF **2,014**、RAMB36 **8**；3,159/3,159 条可布线网络完成，路由错误 0 |
| Ethernet 三时钟系统 | 读取既有路由 DCP，生成 8 类诊断报告 | 保留 **34 项 CDC Warning** 和 **1 项缺失输入延迟**，返回 `review_required` |
| Crypto DMA SoC | 读取既有路由 DCP，查询路径和对象 | 返回 5 条关键路径及 10 个受查询数量限制的网表对象 |
| XSim 参数化夹具 | VHDL/SV、include、宏、参数、库、plusargs、seed | 正常测试通过；故意注入 Fatal 被判为仿真验收失败，即使进程返回 0 |
| 本机目录查询 | 命令、器件、IP 和含 Tcl 特殊字符的查询 | 均通过；查询字符串保持数据语义 |

AXI 在本轮重新仿真与实现；Ethernet 和 Crypto 使用已有 DCP 分析。新流程在综合前读取 XDC，与旧基准流程存在差异，因此这些资源和时序数据作为本轮工具验收记录。原基准成绩与失败证据继续保留。

12 份 trace 均通过事件顺序、终态、输入快照及当前文件哈希检查；未发现输入漂移或未解析依赖。哈希核验范围限于已记录输入。

## 对复杂工程的作用

Agent 可以从明确的文件清单、器件和约束开始，生成 DCP，再按报告定位时序路径、网表对象和 CDC 风险。每步都有可复查的 Tcl、日志、参数、输入哈希及失败回执。DRC/methodology 的详细结论保留在原始报告中；缺失指标保持未知。

调用链：**当前 Codex / 可选 Pi → 共享 15 项工具 → 本机 Vivado / XSim → 报告与 trace → 验收判断**。使用方式见[工具说明](fpga-native-tools-2026-10-24.md)，原有[框架与 trace 文档](agent-framework-and-traces.md)继续适用。

CLI 已可直接使用；已连接且缓存旧目录的 MCP 客户端需重连 `eda-local` 才会显示全部 15 项。49 个 AMD Ross 技能已加载，官方 Ross MCP 可执行文件仍未取得。

## 保留的失败与限制

- 首次验收触发客户端默认 60 秒超时；已修正 MCP SDK 调用选项，并保留首次失败回执 (local/optional evidence; see results/catalog.json)。
- 另一次综合出现 Vivado 自带 `retarget_vhdl.tcl` 读取失败，见原始日志 (local/optional evidence; see results/catalog.json)。文件存在，根因尚未确定。验收脚本改为先 XSim 后 Vivado 的串行调度后通过；尚不能据此认定并发是根因。
- 尚未覆盖 IP 参数配置/产品生成、复杂 IP 仿真库、Block Design 自动组装和板级调试。现有项目 Tcl 入口可继续执行这些工程流程。
- 本轮为 OOC 验证；没有 bitstream、上板验证或形式化 CDC 证明。Ethernet 的 34 项 CDC Warning 仍需设计审查。额外模型 API 为 0；本轮 Codex token 未单独计量。

## 证据

- 完整调用参数与 12 项结果 (local/optional evidence; see results/catalog.json)
- 机器可读成绩 (local/optional evidence; see results/catalog.json) · 12 份 trace 完整性核验 (local/optional evidence; see results/catalog.json)
- 离线测试日志 (local/optional evidence; see results/catalog.json) · AXI 实现结果 (local/optional evidence; see results/catalog.json)
- Ethernet 诊断结果 (local/optional evidence; see results/catalog.json)

复跑：在 `${WORKSPACE}` 执行 `node scripts/validate-fpga-tools.mjs`；默认串行，写入新的验收目录。`npm test` 执行离线测试。
