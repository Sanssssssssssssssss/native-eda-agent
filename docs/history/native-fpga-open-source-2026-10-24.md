# FPGA Agent 开源选型与本机验证 · 2026-10-24

后续更新：本地社区 MCP 已扩展至 **45 工具、11 Prompt**，工程/IP/BD 流程 33/33 项集成检查通过；见[覆盖与验收](../vivado-workbench-coverage-2026-10-24.md)。下文 32 工具和 13 项检查为扩展前上游基线。

推荐社区 `vivado-mcp` 负责当前工程交互，以 AMD FPL'26 官方起始框架及获奖项目研究优化 Agent。官方最终成绩为 **AER 第一、RouteAgents 第二、ESCA 第三**，起始框架自身不代表最优方案。[官方最终榜单](https://xilinx.github.io/fpl26_optimization_contest/results.html) 本地尚未复现这些竞赛成绩。

15 个接口描述的是已有基础适配层。完整工程能力还取决于持续会话、异步任务、IP/BD 操作、报告与波形分析、策略选择、候选管理和独立验收。工具目录条目数应与这些能力分别核验。

| GitHub 项目 | 本次核对的内容 | 本地结论 |
|---|---|---|
| [mapleleavessssssss-wq/vivado-mcp](https://github.com/mapleleavessssssss-wq/vivado-mcp) | **32 工具、11 工作流 Prompt**；持续 Tcl/GUI/attach 会话、异步实现、时序比较、CDC、VCD、IP/XCI；Apache-2.0；161 stars | 当前首选执行后端。Windows/Vivado 2020.2 的指定集成路径实测通过 |
| [Xilinx/fpl26_optimization_contest](https://github.com/Xilinx/fpl26_optimization_contest) | 官方 `dcp_optimizer.py` 起始 Agent、**17 个 Vivado + 17 个 RapidWright 工具声明**、优化策略、DCP 验收器；Apache-2.0 文件许可；55 stars | 已保留源码，24 项验收器单测通过；完整优化方案进一步参考 AER / RouteAgents，完整 EDA 优化未运行 |
| [Shinei-Nouzen-Arch/FPGA-Agent](https://github.com/Shinei-Nouzen-Arch/FPGA-Agent) | 9 个工程技能及 DSE 主控/探索/改进/交叉工作流、候选证据与 Pareto 工具；GPL-2.0；180 stars | 适合参考实验编排。属于技能与配套脚本，依赖宿主 Agent；Windows DSE 测试 38 通过、1 跳过、2 错误 |
| [wmm246/fpga-mcp](https://github.com/wmm246/fpga-mcp) | README 称 689 工具；源码目录实际为 Vivado 441、Quartus 167、Anlogic 157、common 51 条定义；MIT；5 stars | 未作为可用后端接入。声明包路径不存在，common 引用了 **29 个缺失 handler**，导入失败；[社区 issue](https://github.com/wmm246/fpga-mcp/issues/1)也记录了相关问题 |
| [LNC0831/SynthPilot](https://github.com/LNC0831/SynthPilot) | README 称 510 个 Vivado 工具，包含许可激活流程；56 stars | 公开仓库主要提供产品说明，未找到可独立修改运行的完整后端源码，未计作开源 Agent 底座 |
| [Xilinx/ross-ai-assistant](https://github.com/Xilinx/ross-ai-assistant) | 官方开放技能/文档，Vivado MCP 需单独从 AMD 获取；MIT；206 stars | 本地保留此前接入的 49 个技能；官方 MCP 二进制仍未取得 |

Stars 为本次 GitHub 查询时的关注度，不能证明实际用户量或工程成熟度。元数据与提交记录 (local/optional evidence; see results/catalog.json)保留查询来源。另审阅了 `newtonsart/vivado-mcp-server` 和 `lzw12123/mcp-for-vivado`；其 GitHub 元数据未标识许可证，本轮未采用。

## 已经落地的部分

`vivado-community` 已加入项目 `.codex/config.toml` 和 `.pi/mcp.json`；原配置备份位于本轮验收目录。实际 MCP 握手返回 **32 工具、11 Prompt**，两套客户端配置一致。现有客户端需重连后发现新增服务。Pi 继续保持额外模型调用禁用。

本地入口：[Native Vivado Workbench](../../projects/native-vivado-workbench/README.md)。源码固定于 `41745b29af31a34d9b6756a9105313215d9f568e`，使用独立 Python 环境；没有运行上游全局安装脚本。

| 本机检查 | 结果与范围 |
|---|---|
| 社区项目上游测试 | **998 通过、3 跳过**；主要为解析、协议和隔离测试，不等于 998 个 FPGA 设计 |
| MCP / 本机 Vivado 集成 | **13/13 通过**；离线时序/CDC/VCD、持续会话、DCP 打开、在线时序与基线比较、Tcl 错误恢复和关闭 |
| AXI 既有路由 DCP | Setup **+2.393 ns**、hold **+0.058 ns**；两次观察差值 0，返回 `observational`，不将其解释为优化收益 |
| Ethernet 既有 CDC 报告 | 读取并保留 **34 个 Warning**；未宣称 CDC 签核 |
| FPL'26 验收器 | **24/24 单测通过**；尚未执行官方 benchmark、RapidWright 或 DCP 等价仿真 |
| FPGA-Agent DSE 配套测试 | 41 项中 **38 通过、1 跳过、2 错误**；错误分别是 Windows 脚本启动 WinError 193、符号链接权限 WinError 1314 |

社区后端有自己的会话队列，尚未统一接入 `eda-local` 的共享资源锁与逐工具 trace；已在项目指令中要求跨后端串行运行真实 EDA、保存返回值和输入/约束哈希。当前未验证全部 32 工具的现场路径，GUI、板卡编程、IP/BD 自动构建均不在这 13 项范围内。

## 完整 Agent 的开发方向

FPL'26 的实际调用链是：`dcp_optimizer.py` → Vivado / RapidWright MCP → 分析关键路径与高扇出、选择优化策略 → 布局布线 → 测量 → DCP 验收。公开示例包含 LogicNets、VexRiscv；验收器使用结构检查与仿真比较，仿真覆盖并非形式化等价证明。参见[官方源码与执行说明](https://github.com/Xilinx/fpl26_optimization_contest#running-the-optimizer)。

它要求 Vivado **2025.1**，Vivado 后端使用 POSIX `pexpect.spawn`。本机 Windows + Vivado **2020.2** 尚不能直接承诺跑通官方 DCP。仓库中的 OpenRouter 模型入口没有启动；后续应将策略编排接到当前 Codex / Pi，复用已验证的本地执行能力，再以固定时钟、IO 约束、功能检查、路由 WNS/TNS、资源和耗时衡量优化效果。

源码位置：

- `${WORKSPACE}\vendor\vivado-mcp-community` — 当前可用后端。
- `${WORKSPACE}\vendor\fpl26-optimization-contest` — 完整优化 Agent、两个 MCP 后端、验收器；源码稀疏检出，RapidWright 子模块与 benchmark 数据未下载。
- `${WORKSPACE}\vendor\FPGA-Agent` — 工程技能与 DSE 工作流参考。
- `${WORKSPACE}\vendor\fpga-mcp` — 保留未修改源码和失败审阅证据。

## 原始证据

- 社区版 13 项集成结果 (local/optional evidence; see results/catalog.json) · 项目配置握手 (local/optional evidence; see results/catalog.json) · 上游测试日志 (local/optional evidence; see results/catalog.json)
- FPL'26 测试 (local/optional evidence; see results/catalog.json) · DSE 测试及 Windows 错误 (local/optional evidence; see results/catalog.json) · 大目录项目的导入失败与缺失 handler (local/optional evidence; see results/catalog.json)

本轮额外模型 API 调用 **0**；当前 Codex token 未单独计量。调研工具维护提示：Agent Reach 检查到 v1.6.0，本机 v1.5.0；未更新。需要时可发送“帮我更新 Agent Reach：[更新说明](https://raw.githubusercontent.com/Panniantong/agent-reach/main/docs/update.md)” 。
