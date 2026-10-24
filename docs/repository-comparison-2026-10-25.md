# 对照成熟 Agent 仓库后的差距与改进

最主要的差距是任务级状态和交付合同。此前我们已经有工具调用、trace、资源调度、benchmark 和物理优化器恢复，但一个完整 FPGA 项目的步骤、预算与验收仍主要由聊天串联。本轮将其补成可执行的持久化 workflow，并保留 Pi 作为 Agent SDK。

参考的是源码能力，未借用其他仓库的 benchmark 分数作为本项目成绩。源码固定提交及阅读路径见 [研究索引](reference/repository-comparison.json)。

| 对照对象 | 源码中确认的能力 | 我们此前的状态 | 本轮处理 |
|---|---|---|---|
| [Pi session](https://github.com/earendil-works/pi/blob/6c2fd73b0c545a4034672cb60e34d53e035dd751/packages/coding-agent/docs/sessions.md) | 会话保存、恢复、分支与上下文压缩 | 已依赖 Pi 1.3.0；已有 SDK 会话日志，EDA 任务尚无统一持久化规格 | 继续复用 SDK；另持久化 EDA 任务规格与检查，不自建模型会话框架 |
| [Pi durable](https://github.com/earendil-works/pi/blob/6c2fd73b0c545a4034672cb60e34d53e035dd751/packages/durable/README.md) | 状态提交、任务所有权、恢复与请求去重；包明确标记 experimental | 有单次工具 trace、队列和优化器候选恢复 | 借鉴先提交再推进的顺序；增加任务边界文件、事件及原子指针。未安装 experimental 包，未宣称其完整事务/去重能力 |
| [OpenHands SDK persistence](https://github.com/OpenHands/software-agent-sdk/blob/acd96e6fa424c02432304395b9208f99be24b54d/examples/01_standalone_sdk/10_persistence.py) | 通过 conversation ID 与 persistence_dir 重新打开会话 | 会话和工具输出存在，但多工具设计任务主要靠人工衔接 | 工作流在新运行中恢复完成前缀；核验源状态、输入、代码、结果和子进程所有权 |
| [OpenHands stuck detector](https://github.com/OpenHands/software-agent-sdk/blob/acd96e6fa424c02432304395b9208f99be24b54d/openhands-sdk/openhands/sdk/conversation/stuck_detector.py) | 检测重复动作/错误和其他停滞模式 | Pi wrapper 有 turn/time 限制；工具工作流没有统一失败决策 | 确定性流程遇工具/检查失败即停，不自动重试；尚未新增通用模型会话的循环检测器 |
| [mini-swe-agent](https://github.com/SWE-agent/mini-swe-agent/blob/04d809ceab9df28f9adaed044884180159172930/src/minisweagent/agents/default.py) | 明确调用、时间、成本限制，保存轨迹与退出原因 | 单工具有 timeout，模型 wrapper 有 turn/time cap | 增加任务调用数/时间预算与结构化 outcome；沿恢复链累计。模型关闭期间没有虚构美元/token 限额 |
| [LangGraph checkpoint](https://github.com/langchain-ai/langgraph/blob/4c52e129eb1ab69a3da58b799f67929f77d81149/libs/checkpoint/README.md) | 保存图状态和已完成节点的 pending writes，恢复时避免重做成功节点 | 只有物理优化器具备持久候选边界 | 先实现串行 FPGA 任务的已完成前缀复用；不引入整个 LangGraph，不宣称任意 DAG/分布式调度 |
| [RouteAgents](https://github.com/Geochatz3/routeagents-fpl26/tree/4a929b490dad048198e746d15c475a8c19dc5017) | 测量驱动候选选择、预算、最佳候选保留和复测 | 这些已部分接入本地优化器，且保留 0 ns 实跑收益 | 延用现有优化器；工作流中保持工具完成与验收结果分离，不重复包装成新的竞赛复现 |

## 已补齐的工程内容

- [任务内核](../src/workflow.mjs)：规格 schema、参数前检、固定输入、步骤引用、显式验收、预算、持久化、续跑和 trace 关联。
- [原生入口](workflows.md)：5 个 workflow 接口与 CLI；MCP 的 `isError` 和 CLI 非零退出码保留真实验收失败。
- [故障注入检查](../tests/workflow.test.mjs)：输入/实现/产物变化、失败门、预算、取消、恢复、活跃所有者和损坏记录。本轮 EDA 后端使用假实现；另跑真实本机只读工具的离线任务。
- [AXI 工程规格](../examples/workflows/axi-fabric-ooc.json)：固定仿真、综合、实现、DRC 报告的引用链；本轮完成静态 plan，未新增 FPGA 实跑成绩。
- 维护入口：[贡献规范](../CONTRIBUTING.md)、[版本记录](../CHANGELOG.md)、Issue/PR 模板、注册表生成文档，以及成功/失败均上传的 CI 软件验收回执。

## 仍然存在的差距

| 优先级 | 缺口 | 当前边界与下一步 |
|---|---|---|
| P1 | 通用模型会话恢复和停滞治理 | 本轮完成任务级串行恢复；Pi 的完整模型会话 resume/steer/compaction 路径仍需单独合同测试。用户启用模型后再验证真实 provider 行为 |
| P1 | 新任务层的真实工程验收 | 软件故障边界已验；需要之后对固定 AXI/多时钟项目真实跑完整 workflow 并核对新产物，不能拿旧成绩代替 |
| P1 | 独立保留题集与学习收益评估 | 目前 11 组是可见题/集成/工具验收/历史结果，存在重叠；尚无新任务层的盲测成功率、成本收益曲线 |
| P1 | 执行环境隔离 | 当前进程和产物目录隔离，仍在 Windows 主机执行；不是容器、VM 或远程多租户安全边界 |
| P2 | 请求去重与并行 DAG | 目前串行、每次调用新运行；同一旧状态可以显式分叉，未承诺 exactly-once 或全局请求幂等 |
| P2 | 更多设计验收类型 | 形式证明、板卡测试、完整 CDC 签核、Linux/远端执行仍需真实工具环境与案例；不会用空接口标成完成 |

已有 53 个原生接口与社区 45 工具的数量只用于导航。成熟度判断应看“失败能否识别、状态能否恢复、输入是否冻结、成果能否复核、干净环境能否复现”。本轮软件验证和历史成绩保持独立记录。

## 本轮验证

开发目录完整离线验收：71 项 Node + 21 项 Python 全通过，配置检查通过。故障场景覆盖工具失败、验收失败、结果/DCP 样本/输入/头文件目录变化、代码变化、累计预算、硬中断未计时区间、超时、取消、活跃子进程和损坏 checkpoint。EDA 后端是测试假实现，DCP 样本不用于验证真实器件设计。

另通过 CLI 实际执行本机 `eda_preflight` → `eda_results_verify`；任务和父 trace 均通过完整性检查。AXI 四阶段规格完成静态 plan，`launches_eda=false`，实际执行需要 EDA 的信息单列为 `execution_requires_eda=true`。

发布副本的独立验收回执见 `release/validation.json`，GitHub Actions 保存每次成功或失败的精简日志。其他模型 API 调用 0；新 Vivado/LTspice 执行 0；外层 Codex token 未计量。11 组历史成绩未重跑或改写。
