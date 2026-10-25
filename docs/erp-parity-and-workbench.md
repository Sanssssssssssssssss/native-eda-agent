# ERP 机制对照与本地工作台

v0.6 将任务上下文、独立工程目标核验、会话视图和分类评测接入执行框架。v0.7 进一步对照 ERP 的 SessionRail、ConversationPane、BusinessWorkspace 和作用域协议，重做会话到任务的操作流程。当前界面和验收记录见 [v0.7 工作台](workbench-v07-acceptance.md)；没有宣称完成 ERP 全部能力或真实模型质量评估。

## 源码对照

2026-10-25 只读检查本机 `erp-harness-refactor`（HEAD `8932962`，存在未提交修改）与 `pi-odoo-harness-lab`（HEAD `6821615`）。下表针对实际读到的文件，不将 HEAD 当作这些工作区文件的完整版本。

| ERP 中核对的机制 | EDA 落点 | 尚存差距 |
|---|---|---|
| `app/business_outcome.py`：宿主绑定目标，读取事实后判定；未绑定或未观察保持 unknown | [task-outcome](../src/task-outcome.mjs)：固定验收 profile，绑定功能/综合/物理证据，重新读取已提交结果 | 当前只覆盖三类 profile；不证明测试平台参考模型独立、formal 或硬件正确性 |
| `tools/recovery.py`：同范围重复失败停止重试 | [workflow](../src/workflow.mjs)：同输入、参数、步骤、失败类别累计三次后阻止 resume，保留失败目录 | 无通用模型纠错循环；新建任务不受旧恢复链计数约束 |
| `tools/dynamic_tools.py`：按业务范围提供工具合同 | [task-context](../src/task-context.mjs)：按阶段和相关规则选最多两个 SOP，只返回其所需实际工具 schema | 返回建议上下文，尚未自动替换 Pi 当前轮的工具集合 |
| `erp/knowledge.py`：缓存带身份范围，使用前重新核验事实 | workflow 重新核对源码、输入、子 trace、结果与产物；评测页标记源码漂移 | EDA 是单用户本机应用，无 ERP 的用户/公司权限隔离 |
| `app/runner.py`：显式目标失败可做有限纠正；unknown 不触发写重放 | 工程结果区分 passed / failed / unknown / review_required；unknown 不自动重跑 | 不提供自动修改 RTL 的修复循环 |
| 原生 Pi/Odoo 的 SOP 与工具协作 | 同一注册表服务 CLI、MCP、Pi、本地工作台；6 个 SOP 可读、可发现、可冻结；共享 Pi 驱动可续接本项目会话 | SOP 人工判断尚未自动计分；模型续接仅假 SDK 验证，压缩未完成合同验收 |

所读 ERP 文件 SHA-256：

```text
app/business_outcome.py a2a02ba0cc63c54fa36e6eee076ac7a40895ea6835cfc3cc389fb6cabef944fb
tools/recovery.py       4e9174f74826f5769e34ba92078e98ff398d8305548af273926e6ecec601c935
tools/dynamic_tools.py  a3ba2997fe67abe03b5204b21caec808bd4a54e1f72b137ff39257c845641c7d
erp/knowledge.py        f262308df00f93932c2d6f17206dba78b9718b2977e6696de6f9da5efee7d4ae
```

## 启动与操作

完成 README 中本地 setup 后：

```powershell
npm run workbench
# 浏览器打开 http://127.0.0.1:4317
```

1. **会话**：输入工程问题，选择阶段，保存问题、规则、来源、SOP 和所需工具；支持重命名、归档与恢复，会话存在 `.eda-state/workbench-sessions/`。模型 API 当前关闭。
2. **工程任务**：从当前会话准备模板或项目 workflow，审阅固定计划后执行；任务卡关联执行、取消与证据。历史执行详情保留步骤、领域验收、完整性与恢复建议。
3. **知识与 SOP**：检索规则并展开完整流程。来源版本与所需证据保留；命中不代表工程通过。
4. **评测**：分别运行软件、检索、证据和真实 EDA 评测；提供已有 Pi 会话与子 workflow 目录可以核验一次会话任务。分类与分母见 [评测协议](evaluation.md)。

服务只绑定 `127.0.0.1`，检查 Host/Origin，文件入口限制在本项目；没有远端登录或多人权限系统。会话、任务、job 与事件保存在磁盘；取消只操作当前服务拥有的任务，确认原所有者死亡后才标记 interrupted。重启不会自动重放。Pi 聊天入口共用 CLI 驱动，当前配置在 SDK 加载前拒绝模型调用；steer 与 compaction UI 尚未提供。

## 上下文范围的可观察数据

对问题“AXI 工程已经能仿真，100 MHz 布线后 hold 失败，怎样定位并固定验收？”，指定 `phase=timing`：返回 5 条规则、2 个 SOP、9 个工具合同。工具 schema JSON 为 **3,045 bytes**，全注册表 55 个合同为 **23,598 bytes**。这是合同文本体积，尚未包含规则/SOP 全文，也不是模型 token 或费用节省实测。

上下文工具可带 `directory` 重新核验已存在的 workflow。源码或输入变化会保留 unknown 及变化原因；不会复用过时的成功结论。

后续优先项：独立检索/SOP 保留题、答案引用忠实度、真实 Agent 多轮复杂工程评测、模型会话生命周期与自动工具发布。当前实现及成绩分别见 [机制表](mechanisms.md) 和 [功能成绩](results.md)。
