# ACE-RTL 原版组件与验证闭环

本项目已保留升级前基线，并将 NVIDIA ACE-RTL 固定版本放入 `vendor/ace-rtl`。Python 桥接实际执行三个原版入口；本地主循环将当前 Pi 会话生成的候选交给固定 workflow 验证，失败后带反馈继续，直到通过、需人工审查、停滞、取消或预算耗尽。Pi/Vivado 接线由本项目实现，上游没有声明原生支持这套组合。

## 基线、来源与许可

- 升级前基线：本地 `artifacts/baseline-before-ace-upgrade-20261026-011951/manifest.json`，清单 **226 个文件**，记录来源、大小及 SHA-256。范围为源码、测试、网页、文档、知识、案例和非秘密配置；既有运行产物、会话、运行环境与 vendor 保留原处。三项此前编辑的文件按清单指向的备份还原至此基线；备份清单不分发到 Git。
- 上游固定版本：[`NVlabs/ACE-RTL@94754d796350d42502c9a32639a20d86f50e9678`](https://github.com/NVlabs/ACE-RTL/tree/94754d796350d42502c9a32639a20d86f50e9678)，核对日期 2026-10-26。vendor 源码保留原始内容及版权。
- [上游 LICENSE](../vendor/ace-rtl/LICENSE)：纯代码和脚本为 **Apache-2.0**；混合文档及 skill Markdown 为 **CC-BY-4.0 AND Apache-2.0**。详见 [第三方声明](../THIRD_PARTY_NOTICES.md)。

## 实际调用链

```text
当前 Pi 会话生成/修复限定 RTL
  → 宿主检查固定输入与预算
  → 新 workflow 运行固定验证工具
  → inspectWorkflow 回读证据，task-outcome 分领域验收
  → 未通过时执行原版 ACE 反馈组件
  → 当前 Pi 会话接收报告和反馈，继续修复
```

| 入口 | 本轮执行内容 | 依据与边界 |
|---|---|---|
| 原版 `ContextBuilder.build_context` | 根据规格、当前 RTL 与宿主失败报告生成诊断上下文 | [原版源码](https://github.com/NVlabs/ACE-RTL/blob/94754d796350d42502c9a32639a20d86f50e9678/skills/ace-rtl/scripts/ace_rtl_agent/context_builder.py)；规则提示不能判定工程通过 |
| 原版 `FreshStartCoordinator.add_iteration_result` | 记录最多 8 次已完成观察，保留各次失败与候选 | [原版源码](https://github.com/NVlabs/ACE-RTL/blob/94754d796350d42502c9a32639a20d86f50e9678/skills/ace-rtl/scripts/ace_rtl_agent/fresh_start_coordinator.py)；由桥接重新编号，当前观察必须位于历史末尾 |
| 原版 `FreshStartCoordinator.should_fresh_start` | 执行继续/换思路建议，包括连续三次零输出功能失败的启发式 | 建议只影响下一轮修复方向，不能重置文件、增加模型或覆盖 verifier 结论 |
| [本地桥接](../scripts/ace-rtl-feedback.py) | 核对所用原版源码 SHA-256，替换模型依赖，stdin/stdout JSON 通信 | 导入前封住模型客户端；不读取凭据，不传 harness 目录，不扫描私有测试；额外模型请求明确标 `deferred_to_pi` |
| [本地验证循环](../src/verifier-loop.mjs) | 固定合同、可编辑范围、保护输入、逐轮实验证据、调用与轮数预算、重复失败停止 | 由宿主决定 passed / failed / unknown / review_required；独立记录 `verification-contract.json` 和 `verification-loop.json` |
| [Pi 会话驱动](../src/agent-session.mjs) | 复用当前会话执行下一轮生成，记录任务验收与会话用量 | 会话 `completed` 与工程 `passed` 分别记录；角色职责不代表额外启动三个模型 |

最终验收仍由 [workflow](../src/workflow.mjs) 与 [task-outcome](../src/task-outcome.mjs) 完成。固定 testbench、约束、规格及其他非可编辑输入受漂移检查约束；功能 top 的测试文件和显式 `protected_sources` 不允许列入可编辑项。宿主验证任务自动创建候选，并通过 Pi tool-call hook 限制写入范围、阻止 shell 与模型直接发起 EDA。这些检查不是操作系统文件沙箱。候选、续跑、压缩后上下文和交付入口见 [完整任务生命周期](agent-lifecycle.md)。

## 使用入口

创建本地 `verification.json`，指定已有 workflow 和允许修改的 RTL，例如：

```json
{
  "spec": "examples/workflows/axi-fabric-ooc.json",
  "editable_sources": ["projects/hard-bench/axi-fabric/rv_delay.sv"],
  "max_rounds": 2,
  "max_calls": 16
}
```

已有 [AXI 示例配置](../examples/verification/axi-fabric.json) 可以先做静态准入检查；会保存完整合同，不启动模型或 EDA：

```powershell
node src/agent.mjs verification plan examples/verification/axi-fabric.json
node scripts/demo-verifier-loop.mjs
```

第二条命令在独立 artifacts 目录复制所需输入，使用假生成器和假 XSim，执行真实 workflow、trace 与 NVIDIA Python 反馈；预期第一轮 failed、第二轮 passed，保留原始失败和固定 checker 哈希。这是软件闭环演示，不能计入 RTL 设计正确率。

```powershell
node src/agent.mjs run --verification verification.json --timeout 3600 "检查并修复限定 RTL，使其满足固定 workflow 验收；保留需审查项"
```

这是执行入口，会调用所配置模型与 workflow 中的 EDA 工具。当前用户要求关闭额外模型 API，配置门保持关闭，本轮没有执行此命令。`max_calls` 仅计宿主 verifier 的工具调用；Pi 轮数和整段时间由会话预算约束。可用 `protected_sources` 补充固定辅助 checker；每轮失败不会放宽原验收条件。AXI 的历史 DRC warning 仍为需审查，不能算本轮优化收益。

`run --verification` 现在自动创建候选副本、重写仿真/综合输入并保留原始文件。也可先 `task prepare`，再用 `run --task` 执行该任务。工作台“验证任务”提供配置表单、候选范围、验证状态和恢复入口；`/api/agent` 复用同一宿主驱动。底层 `runVerifiedLoop` 仍是对显式给定路径工作的原语；直接使用该函数时由调用方准备隔离范围。

失败反馈包含领域状态、固定 checks 的失败值和证据路径。编译工具抛错时，workflow 只接受具有当前父 trace 的原始失败 receipt，冻结最多 6 KiB 日志尾部；重读时再查哈希和输入。诊断用于修复提示，不能满足工程验收。最终 `run.task_acceptance` 使用独立回读结果，`verification.status` 保留循环结束时的历史结论。

## 复用范围与验证结果

原版 `FocusedDebugger.create_focused_prompt` 会内部调用模型，原版 `generate_fresh_rtl` 也会调用模型；本轮生产桥接不启动它们。原版 `IterationMemory` 是失败记录与简单模式提示，其上下文会拼接全部失败，当前未接入；它不等同于有界会话压缩。本地反馈输入总量上限 1 MiB，RTL 96 KiB，规格/报告各 16 KiB，历史最多 8 项，上下文最多 12000 字符并标记截断。

原版 workflow 文档规定受限 evaluator 反馈；部分旧 harness 上下文分支会读取 `.env` 和 checker，故本地没有调用该分支。原版 CVDP 并行竞赛及专用 runner 未接入。这里是原版反馈组件加本地 verifier 的闭环，并非完整移植上游实验体系。

首次接入时的 `npm run validate:agent` 通过 **216 项 Node、21 项优化器 Python、7 项 ACE 桥接检查，共 244 项，0 跳过**；另有配置、知识一致性和两轮闭环演示。[首次回执](../release/verifier-loop/validation.json)保留当时的日志与哈希；当前完整任务层验收见 [发布回执](../release/README.md)。

[两轮演示回执](../release/verifier-loop/demo.json)记录 2 次生成、2 次宿主验收：第一轮 failed、第二轮 passed，固定 checker 哈希一致，原版三个反馈入口实际执行。生成及 EDA 验证采用假后端；这些是软件机制验收，没有真实模型长任务或 FPGA 提分成绩。[AXI 静态合同](../release/verifier-loop/axi-plan.json)（可用上方 `verification plan` 命令复核）已通过准入检查，绑定 fpga_ooc，保护 25 个输入，限定 2 轮、最多 16 次宿主验证工具调用。

本轮额外模型 API 与 EDA 执行均为 **0**；外层 Codex 用量不包含在该数值内。后续真实效果需要固定任务、固定测试、相同预算的对照评测。

相关合同：[Agent 工作流与 trace](agent-workflow-and-trace-contract.md)、[RAG 与 SOP](knowledge-and-sops.md)、[历史协作与 trace](agent-framework-and-traces.md)。
