# RouteAgents + AER 本地优化流程

已经写好无需模型 API 的本地优化入口 `eda_vivado_optimize`，共用 Codex/Pi 的原生工具注册、Vivado 资源锁和 trace。它直接调用固定版本 RouteAgents 的纯特征路由模块，结合 AER 的收益停止规则，驱动本机 Vivado MCP 执行候选、保留最佳 DCP、最后重新测量。

两份源码分别保存在独立目录，未启动上游模型入口：

| 来源 | 本地目录与固定提交 | 使用部分 |
|---|---|---|
| [RouteAgents](https://github.com/Geochatz3/routeagents-fpl26) | `vendor/routeagents-fpl26`，`4a929b490dad048198e746d15c475a8c19dc5017` | 实际导入 `optimizer/recipe_router.py`；参考候选保留、有效状态接纳、预算与重新验证机制 |
| [AER](https://github.com/haeun-josue/fpl26contest-AER-optimizer) | `vendor/aer-fpl26-optimizer`，`e325940dd7b5af3e13265f912d4812218cd0ae66` | 参考首步排序、从原始 DCP 全局重新布局、有收益后遇到无收益动作停止的规则 |

两者均为 Apache-2.0；许可证和 NOTICE 留在各自目录。RouteAgents 当前主分支包含赛后整理，不能直接把本次适配等同于决赛提交。源码采用稀疏检出；未初始化 RapidWright 或下载竞赛 DCP。固定来源及运行时模块 SHA256 见 [.eda/optimizer-upstreams.json](../.eda/optimizer-upstreams.json)，模块变化会拒绝加载，需审阅后重新固定。

```mermaid
flowchart LR
  C[当前 Codex / Pi 工具调用] --> T[eda_vivado_optimize\n共享资源锁和 trace]
  T --> S[测量输入 DCP]
  S --> P[RouteAgents 特征路由\n本机策略适配]
  P --> E[复制候选输入\nVivado MCP 执行]
  E --> G[约束与逻辑表示比较\n布线 / hold / DRC 检查]
  G --> B[保留更优候选]
  B --> A[AER 停止规则与时间预算]
  A --> E
  A --> F[重新打开最终候选并复测\n输出结果与证据]
```

| 已实现机制 | 具体行为 |
|---|---|
| 无模型执行 | 不导入上游 `dcp_optimizer.py`、OpenAI SDK 或模型客户端；MCP 仅连接本机 stdio。`.eda/config.json` 仍为 `model_api_enabled=false` |
| 首步选择 | 默认依据测量特征；当前 Codex 可以用 `first_play` 选择固定目录中的首个动作，随后由规则继续 |
| 候选保留 | 每次复制输入到独立目录；重新布局从原始 DCP 开始，增量布线从当前最佳结果开始。原子更新 `best.json`，不覆盖原输入 |
| 接纳检查 | 比较时序 XDC、funcsim Verilog 表示和接口指纹；要求路由完整、无 hold/pulse-width 违例、无 DRC Error/Critical Warning、时钟与 IO 约束检查完整；未知指标拒绝接纳 |
| 性能目标 | 同一组约束下 WNS 增益超过 `min_gain_ns`，且 TNS 不退步。多时钟情况下不把全局 WNS 随意换算成 Fmax |
| 停止条件 | 有收益后遇到无收益动作停止；连续两次无收益停止；试验次数或预计剩余时间不足也停止。时间预测先使用明确的本机启发值，再利用实测耗时 |
| 最终复测 | 重新打开最佳 DCP 测量；指标不稳定或复测失败时退回原始结果。模型文字不能将失败候选接纳 |
| 超时与证据 | 持久化每个候选的 Tcl、MCP 响应、完整报告、指纹和拒绝原因。MCP 超时后清理本次独立启动的 Vivado；外层进程有额外 90 秒启动/清理边界 |

完整的 [42 个上游动作映射](../knowledge/routeagents-playbook.json)已落盘，包含原始触发条件、代码入口和本地适配状态。当前 **7 个本机执行策略**：

- 保留布局的 `Explore`、`AggressiveExplore`、`MoreGlobalIterations` 布线。
- 清除布线后重新进行 `AggressiveExplore` 布线。
- 从原始 DCP 用 `Explore`、`ExtraTimingOpt`、`ExtraNetDelay_high` 重新布局并布线。

这些是上游部分动作与 AER 全局布局策略的本地适配；没有宣称全部 42 个动作已经移植。实际运行验证了前两种布线策略，其余五种已有执行路径，现场验证仍待完成。retiming、LUT 改写、驱动复制、pblock 压缩暂未启用；缺少空间分布/资源利用率特征时明确记录缺项，不伪造 RapidWright 结果。

**验证结果**：

| 检查 | 结果 |
|---|---|
| RouteAgents 指定离线测试 | `test_recipe_router.py`、`test_wall_economics.py`、`test_constraint_guard.py`：**153 通过** |
| 本地反例与循环测试 | **16 通过**；涵盖修改约束、逻辑变化、缺失指标、路由未完成、TNS 退步、候选失败、复测失败回退、正 slack 误分类和无网络执行 |
| 原生 MCP 注册检查 | **1 通过**；原生注册表现在为 16 项，社区 MCP 仍是 45 项 |
| 本机 AXI DCP 小规模实跑 | **67.368 秒**，两个布线候选均完成并通过接纳前检查；均无足够收益，保留基线，最终复测通过 |
| 实测指标 | Setup **+2.393 ns**、hold **+0.058 ns**、3159/3159 可布线网络完成；本轮 WNS 收益 **0 ns** |

本轮验证的是优化流程；没有复现 RouteAgents/AER 的竞赛成绩，也没有新增正式等价证明或板级验证。逻辑表示指纹相同是保守检查，可能拒绝语义相同但文本不同的网表；不能替代形式化等价或功能仿真。当前基线自身若有缺失约束或 hold 违例，会阻止优化并保留失败证据。

真实结果：optimizer-result.json (local/optional evidence; see results/catalog.json) · 原生 trace 回执 (local/optional evidence; see results/catalog.json) · 16 项离线日志 (local/optional evidence; see results/catalog.json)。两次早期实跑问题也保留在 `artifacts/2026-10-24T08-52-07-685Z-eda_vivado_optimize-885a49c8` 和 `artifacts/2026-10-24T08-52-50-237Z-eda_vivado_optimize-9b39a9c5`：分别修复 Vivado 2020.2 不支持的日志重定向，以及 MCP timeout 整数类型和超时误分类。

直接使用现有的 AXI 样例：

```powershell
cd ${WORKSPACE}
# 只测量并生成计划
node scripts/eda-tool.mjs eda_vivado_optimize projects/native-vivado-workbench/optimizer-plan.json
# 最多两个候选，180 秒运行预算
node scripts/eda-tool.mjs eda_vivado_optimize projects/native-vivado-workbench/optimizer-run.json
```

更换 JSON 中的 `checkpoint` 即可指定工作区内其他 routed DCP；如要由当前 Codex 指定首步，可添加 `"first_play": "replace_explore"`。通过 `eda-local` MCP 或 Pi 原生扩展调用相同工具；已有客户端需重新加载注册表。单独运行 Python 入口会绕过外层共享资源锁，日常使用上述原生工具入口。

`max_seconds` 支持 60–3600 秒，`max_trials` 支持 1–7。两套项目配置的 `eda-local` MCP 超时已设为 4800 秒，覆盖最长资源排队、执行和清理；配置备份与最终审阅记录 (local/optional evidence; see results/catalog.json)保存在同一目录。工具响应保留摘要和完整结果路径，逐端口明细保存在本地证据文件，避免每次将整个接口清单送入上下文。

代码入口：[工具注册](../src/tools/optimizer.mjs) → [CLI](../scripts/optimize-vivado.py) → [候选循环](../src/fpga_optimizer/runner.py) → [策略与检查](../src/fpga_optimizer/core.py) / [本地 MCP 执行](../src/fpga_optimizer/backend.py)。原有 [Agent 框架与 trace 文档](agent-framework-and-traces.md)保留。其他模型 API 调用 **0**；当前 Codex token 未单独计量。

后续静态改进已接通优化器的选择、候选、MCP 调用和回退事件，并增加 `outcome/next_action` 与离线核验，见 [事件合同](agent-workflow-and-trace-contract.md)。上文实跑成绩来自改动前；新事件链本次只通过离线假后端验证，不属于新的 Vivado 实跑成绩。
