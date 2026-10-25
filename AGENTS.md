# EDA Agent 工作约定

项目导航：[Agent 工作流与 trace 合同](docs/agent-workflow-and-trace-contract.md)。历史成绩和本轮验证分开记录；修改框架时保留 [协作与 trace 文档](docs/agent-framework-and-traces.md)入口。

宿主修复任务按 [任务生命周期](docs/agent-lifecycle.md)执行：`eda_task_prepare` 静态生成隔离候选，`run --task` 接入 verifier；`eda_task_inspect` 检查当前交付和恢复条件。只有已提交的取消回合且预算、所有者与证据检查通过时，才用 `--resume-task`。不得以新会话重置同一任务的验证预算。最终答复以重新检查的 `delivery.json` 为准，保留原模型文字。

原生会话的普通、嵌套及被拒绝工具请求共用 `maxToolCalls`；宿主 verifier 调用另按任务预算累计。注入 factory 的执行来源为 `injected`；假 SDK 或真实 SDK 配固定响应都属于离线软件检查，不能计为线上 Agent 成绩。不得用提供商名称或补写来源字段升级历史成绩。

机制核对见 [源码落点](docs/mechanisms.md)，知识选择见 [RAG 与 SOP](docs/knowledge-and-sops.md)。用 `eda_task_context` 按阶段选择上下文并核验已有任务，用 `eda_knowledge` 检索规则、`eda_sop` 读取完整流程；确认来源版本、适用范围与所需证据。workflow 的 `guidance` 冻结所选规则和 SOP；验收仍由明确的 step checks 执行，不能仅凭检索命中或选用 SOP 宣称通过。

- 先核对任务规格、固定验收条件、输入 RTL/XDC/DCP、器件和时钟。用 `eda_preflight`、`eda_runs action=list` 查看前提和资源状态。
- 当前用户要求停用其他模型 API；以 `.eda/config.json` 和当前指令为准。工具开发、静态分析和本地测试不需要模型调用，不启动上游模型优化器或读取凭据。
- 用户要求静态检查时，只读证据或用假后端做软件检查。`eda_vivado_optimize mode=plan` 会启动 Vivado；`verify` 和 benchmark `run` 也会执行 EDA。
- 原生入口共用 `src/extension.ts` 注册表、`src/trace.mjs` 与 `src/runtime.mjs`。社区/LTspice 使用 `src/traced-mcp-proxy.mjs` 后共用资源租约；重连后的配置才生效。任意 Tcl 启动异步工程时须等待工程结束后才归还执行额度。
- 候选复制到新目录；固定测试、约束和输入不随优化目标放宽。功能、setup/hold、CDC、DRC、布局布线、形式证明和板卡实测分别验收。
- 多步骤任务优先写 [workflow 规格](docs/workflows.md)，包含固定 inputs、每步 checks、结构化 acceptance 领域绑定与累计预算。工程目标由宿主回读证据核验；缺失为 unknown，DRC warning 为 review_required。同恢复链重复失败三次后先诊断。`eda_workflow_plan` 不启动 EDA；`run/resume` 执行声明的工具。失败后先 `resume_check`，仅在输入、代码、完成步骤和所有者检查通过时恢复；续跑使用新目录。
- 返回结果前用 `eda_trace` 检查证据，查看 `outcome`、`winner_recheck`、输入完整性与实际收益。`completed` 仅表示流程完成。trace 记录可观察的选择依据、调用和证据，不推断模型内部思维。
- 无终态时先检查任务所有者；不根据耗时猜测死亡，不终止无关进程。优化器先用 `eda_trace action=recovery-check` 检查，再通过 `resume_from` 从已提交候选边界创建新运行，复测后继续；保留失败产物。
- 历史 trace 不补造 span/时间戳；旧结果只说明当时已记录的证据。外部 MCP 和追踪平台的接通状态按合同中的矩阵报告。

结果报告先写结论，随后只列必要改动、验证、限制、用量与证据链接。其他模型 API 为 0 不代表外层 Codex token 为 0。

OTLP 默认只导出本地文件；只有用户明确要求发送到指定接收端后才使用上传入口。详细入口和边界见 [闭环交付](docs/agent-completion-2026-10-24.md)。完整离线验收使用 `npm run validate:agent`，每次生成独立日志和源码哈希。

验证应覆盖实际风险；低影响可逆改动不写镜像实现的测试。相关检查通过后即可交付，不无理由扩大测试。优化器离线检查：

```powershell
runtime/vivado-community-venv/Scripts/python.exe -m unittest discover -s tests -p test_fpga_optimizer.py
node --test tests/optimizer-trace.test.mjs tests/artifact-storage.test.mjs tests/replay-experiment.test.mjs tests/mcp.test.mjs
```

这些检查使用假 EDA 后端、本机子进程和 MCP 注册服务，不启动 Vivado。Python 后端测试需要项目虚拟环境；系统 Python 缺 MCP 包时会跳过两项，并须明确说明。
