# Vivado Agent：官方归属、公开成绩与工程覆盖

本地社区 Vivado MCP 已扩展为 **45 个工具、11 个工作流 Prompt**：上游 32 个工具，加本项目 13 个工程/IP/Block Design 工具。真实 Vivado 2020.2 的最终集成检查 **33/33 通过**，包含全部 13 个新增工具。计数单位是工具调用验收项；本轮验证工程装配流程，没有新增复杂设计 benchmark 成绩。

**FPL'26 是 AMD/Xilinx 官方竞赛项目。** 官方组织者页面列出 AMD 联系方式，代码位于 Xilinx 组织；仓库提供参赛起始框架。它与 Ross 产品的官方 MCP 分属不同项目。[官方仓库](https://github.com/Xilinx/fpl26_optimization_contest) · [组织者](https://xilinx.github.io/fpl26_optimization_contest/contact.html)

“成绩最好”目前能依据的是 FPL'26 官方最终排行榜：**AER 第一、RouteAgents 第二、ESCA 第三**，平均单题名次分别为 4.286、5.000、6.286；总排名依据七个 benchmark 的名次平均值。此结论只适用于这次比赛。[官方成绩](https://xilinx.github.io/fpl26_optimization_contest/results.html)

| 可研究的完整项目 | 具体价值 | 本机状态 |
|---|---|---|
| [AER](https://github.com/haeun-josue/fpl26contest-AER-optimizer) | 决赛冠军；由测量驱动的规则框架，LLM 只选首个动作，收益停止时提前结束 | 已读公开 README；未下载、未复现分数 |
| [RouteAgents](https://github.com/Geochatz3/routeagents-fpl26) | 决赛第二；42 个优化动作、特征选路、最佳候选保留、预算和有效状态检查；支持无 LLM 模式 | 已读公开 README；未下载、未执行；适合参考 Agent 编排 |
| [AMD 起始框架](https://github.com/Xilinx/fpl26_optimization_contest) | DCP 优化循环、Vivado/RapidWright MCP、验收器和公开 benchmark 入口 | 源码已拉取，验收器 24/24 单测通过；完整优化未执行 |
| [社区 Vivado MCP](https://github.com/mapleleavessssssss-wq/vivado-mcp) | 持续 Tcl 会话、工具执行、报告和波形查询 | 本机执行后端；上游固定于 `41745b29af31a34d9b6756a9105313215d9f568e`，源码保持未修改 |

FPL 体系要求 Vivado 2025.1 与 Linux/POSIX 环境，当前 Windows + Vivado 2020.2 的运行结果不能代替官方比赛复现。RouteAgents 的 42 个动作也不能与 MCP 接口数量直接相加比较。

| 工程业务 | 当前能力 | 证据与缺口 |
|---|---|---|
| 工程接管与版本管理 | XPR 解析、新建/打开工程、添加 RTL/TB/XDC、工程 Tcl 导出与重建 | 本轮真实创建、关闭重开、导出重建通过；导出依赖原源文件，尚非便携归档 |
| IP 集成 | 目录查询、实例创建、CONFIG 参数校验和读回、产品生成、IP 状态/XCI 比较 | Clock Wizard 100→50 MHz 请求参数与产品生成通过；未验证所有 IP 或升级迁移 |
| IP Integrator / AXI 系统 | 创建 BD、添加 IP、标量/接口连线、引出端口、分配地址、校验、生成 HDL wrapper | AXI 互连 + 双 GPIO 流程通过；还缺通用 BD 检查编辑、固定地址规划、自动化时钟复位设计 |
| RTL / IP 仿真 | 本项目 XSim 混合语言/参数化测试、社区 VCD 查询和波形控制 | 既有 RTL 功能仿真已有证据；本轮 BD 未进行 AXI 事务功能仿真，IP 库编译仍需项目 Tcl |
| 综合与布局布线 | 原生综合/实现、持续会话内异步 run 与进度、利用率、DCP/网表查询 | 既有 AXI、Ethernet、DMA 系统有 OOC 结果；本轮新 BD 未新增 P&R 成绩 |
| 约束、时序和 CDC | XDC 检查、setup/hold 路径、报告基线比较、CDC/DRC/方法学检查 | 保留已有 34 项 Ethernet CDC Warning；尚无自动时序收敛或 CDC 签核 |
| 比特流与板级调试 | 上游有 bitstream/program_device、LTX、IO 查询；ILA/VIO 可由 Tcl/技能组织 | 尚未对板卡、DDR、PCIe、GT、ILA/VIO 完成现场验收 |
| 自主优化 Agent | 当前 Codex/Pi 可组织工具循环，已有 traces、实验目录和独立验收 | 仍需移植获奖项目的策略选择、候选管理、预算停止与约束一致性检查，并运行固定 benchmark |

新增工具源码：[src/vivado_workbench.py](../src/vivado_workbench.py)。它导入固定版本上游 MCP，复用同一个会话管理器：

| 工具组 | 新增接口 |
|---|---|
| 工程 4 项 | `wb_project_create`、`wb_project_open`、`wb_project_add_files`、`wb_project_export` |
| IP 3 项 | `wb_ip_create`、`wb_ip_configure`、`wb_ip_generate` |
| BD 6 项 | `wb_bd_create`、`wb_bd_add_ip`、`wb_bd_connect`、`wb_bd_external`、`wb_bd_assign_address`、`wb_bd_validate_export` |

每个 `wb_*` 调用记录参数、开始/结束时间、输入文件哈希（若有显式文件输入）、生成 Tcl、原始输出和结果 JSON；失败回执同样保留。`ok=true` 表示该操作完成，`overall_design_acceptance=not_evaluated` 保留功能/签核边界。调用者应检查 JSON 的 `ok`，不能只看 MCP 传输层是否报错。工程操作检查显式 `project_dir`；路径限于本工作区。属性变更或失败操作可能已部分生效；超时不表示 Vivado 已停止。

**本轮实测工程**：`projects/wb test-1024-082415/axi_workbench.xpr`，Artix-7 `xc7a100tfgg676-2`。Clock Wizard 为独立 IP；BD 内为一个 AXI 互连、8 位与 16 位两路 GPIO、共享外部时钟与复位。地址读回分别为 `0x40000000`、`0x40010000`，分配窗口均为 64 KiB。生成了 BD、XCI、HDL wrapper 和工程重建 Tcl。未将该装配样例视作复杂 FPGA 项目或功能测试成绩。

最终检查覆盖重复目录拒绝、错误工程拒绝、非法 CONFIG 属性拒绝、不存在的 BD 端点拒绝、Vivado 不接受的文件名拒绝，以及正常空格路径。调试中修复了 2020.2 无 `project.FILE_NAME` 属性、地址定义/映射混计、`make_wrapper` 返回未引用路径以及工程导出空格路径问题。工程导出使用明确 origin 和 BD 文件引用，并保留 `project.raw.tcl` 与兼容处理后的 `project.tcl`。

覆盖范围是本次 13 个新工具的指定调用路径，未穷举参数组合；例如 `wb_ip_generate(synthesize=true)` 的 OOC 分支未在本轮执行。配置复核另行重新打开重建工程，确认 part、顶层、独立 Clock Wizard、BD 校验、GPIO 位宽及地址均符合预期。

原始证据：

- 最终 33 项结果 (local/optional evidence; see results/catalog.json) · 实际工具 schema (local/optional evidence; see results/catalog.json) · 配置与重建检查 (local/optional evidence; see results/catalog.json)
- 此前社区 13 项集成 (local/optional evidence; see results/catalog.json) · 998 项上游测试通过日志 (local/optional evidence; see results/catalog.json)
- 完整运行索引 (local/optional evidence; see results/catalog.json)保留七次调试失败及最终通过结果。额外路径诊断见 `artifacts/workbench-path-diagnostic.txt`。不能将最终 33/33 回填为这些早期运行也通过。

`.codex/config.toml` 和 `.pi/mcp.json` 已指向本地扩展入口，旧配置保存在最终验收目录的 `config-before/`。重新连接项目 MCP 后加载 45 工具。当前聊天已绑定的旧 32 工具连接启动会话曾失败，本轮真实 EDA 验证通过本机 Python stdio MCP 客户端完成；新的配置另有握手和会话验收。

当前社区会话队列仍独立于 `eda-local` 的资源锁；跨后端真实 Vivado 运行串行安排。新增工具回执没有冒充原有完整 trace。框架入口保留在 [Agent 框架与实验追踪](agent-framework-and-traces.md)。本轮其他模型 API 调用 **0**，当前 Codex token 未单独计量。

复跑：

```powershell
cd ${WORKSPACE}
runtime\vivado-community-venv\Scripts\python.exe scripts\validate-vivado-workbench.py
```
