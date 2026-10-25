# 工作台复用机制与评测口径

本轮对照 Allure、Aider 和 Backstage 的官方文档与源码，将其测试层级、文件修改范围、资产目录机制接入本地工作台。保留现有 Pi、workflow 和 trace，不引入整套 Java 报告服务或 Backstage 平台。核对日期：2026-10-25。

| 参考实现 | 已核对的机制与源码 | 本地采用方式 |
|---|---|---|
| **Allure Report 2**，Apache-2.0，`b2c4f36` | [`SuitesPlugin.getData`](https://github.com/allure-framework/allure2/blob/b2c4f3635fde6b4f142492f5400539850ac502db/allure-generator/src/main/java/io/qameta/allure/suites/SuitesPlugin.java) 按 parent suite / suite / sub-suite 生成结果树；[`HistoryPlugin`](https://github.com/allure-framework/allure2/blob/b2c4f3635fde6b4f142492f5400539850ac502db/allure-generator/src/main/java/io/qameta/allure/history/HistoryPlugin.java) 保留历史状态。官方文档要求相同测试标识和参数才能关联历史。[历史与重试](https://allurereport.org/docs/history-and-retries/) | 测试分为层、分类、案例、运行记录。目录定义和执行结果分别保存；按 case ID 与定义哈希关联，保留失败、未执行和预期负控。不同环境或协议的历史不汇成一个总通过率。 |
| **Aider**，Apache-2.0，`5dc9490` | [`Coder.allowed_to_edit`](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/aider/coders/base_coder.py#L2191) 区分已加入的可改文件与其他文件；[会话命令](https://aider.chat/docs/usage/commands.html) 提供 `/add`、`/read-only`、`/diff`、`/undo`。 | 会话中显式选定可修改 RTL 和只读参考；将文件范围、基线哈希、差异预览和应用行为做成宿主合同。约束和 checker 默认固定；范围限制必须在写文件的工具层执行。 |
| **Backstage**，Apache-2.0，`36c6cba` | [实体规范](https://backstage.io/docs/features/software-catalog/descriptor-format/) 将元数据、生命周期、所属系统和依赖关系作为独立字段；[`EntityLayout`](https://github.com/backstage/backstage/blob/36c6cbac91157b2a430e531a50abf09bacd8af91/plugins/catalog/src/components/EntityLayout/EntityLayout.tsx) 以实体组织详情与关系导航。 | RTL 项目拥有稳定 ID，关联源文件、顶层、器件、时钟、约束、测试与验收证据。源码存在、仿真通过、布线完成和板卡验收分别显示，文件数量不表示工程完成度。 |

许可证核对：[Allure](https://github.com/allure-framework/allure2/blob/b2c4f3635fde6b4f142492f5400539850ac502db/LICENSE)、[Aider](https://github.com/Aider-AI/aider/blob/5dc9490bb35f9729ef2c95d00a19ccd30c26339c/LICENSE.txt)、[Backstage](https://github.com/backstage/backstage/blob/36c6cbac91157b2a430e531a50abf09bacd8af91/LICENSE)。本轮采用机制并自行实现，没有复制上述项目代码或增加运行依赖。

## 测试分类

`src/workbench-testing.mjs` 的 `getTestingOverview(root)` 只读已有目录和证据，不执行检索、EDA 或模型请求。

| 层 | 分类与计数单位 | 证据入口 |
|---|---|---|
| 软件机制 | 会话与资源、工作台、任务恢复、知识契约、trace、优化、benchmark、工具合同；单位 `software_test` | `agent-offline-*/result.json` 和真实 Node reporter 日志。Python 缺少逐例日志时只展示 runner 汇总。 |
| RAG 与 SOP | reset、CDC、clock、constraint、timing、RTL、width、handshake、formal、negative、trace、无关问题；单位 `visible_query` | 固定查询集及 retrieval receipt；24 条可见查询与 3 条无关查询分别成组。 |
| 工具与案例 | 14 类、5 档 tier、family、variant、tool；单位 `case_variant` | `benchmarks/catalog.json` 与 `benchmark-*/summary.json`、每例 `result.json` 双向核对。77 个目录条目不会自动成为 77 个通过。 |
| 工程验收 | 功能、综合、setup、hold、约束、布线、DRC、CDC、形式、板卡；单位 `project_domain` | workflow 已提交 checkpoint 绑定的 `task-outcome.json` 与各领域报告哈希。未绑定的形式/板卡领域为未执行。 |
| Agent 在线任务 | 真实会话与因果关联 workflow；单位 `session_task` | `online-agent` evaluator 的既有记录。SDK 假后端和浏览器 fixture 归入软件验证。 |

每个案例提供 `latest`、最多六条 `history`、总历史条数和证据路径/哈希。分母保留 `failed`、`unknown`、`not_run`、`blocked`、`review_required`；`expected_failure` 和 `expected_timeout` 独立计数。历史成绩放在 `historical`，保留原来的样本、协议与单位。

软件层会显示整个验证 receipt 的当前源码匹配状态；工具案例会核验定义哈希和独立 case receipt；工程层会核验 checkpoint、领域报告并显示当前输入匹配状态。历史通过不代表本轮重跑，也不替代现有 workflow 的完整恢复检查。

## 范围与验证

扫描只读取命名明确的结果目录和有大小上限的文件，跳过指向工作区外部的符号链接。每次最多读取 12 份软件、40 份 evaluator、40 份 benchmark 和 80 份 workflow 记录；界面中的历史是这一窗口内的可见记录。公开仓库缺少本机 artifacts 时可读取打包的 release 软件与检索证据。

`node --test tests/workbench-testing.test.mjs` 覆盖目录分母、预期负控、定义漂移、case receipt 篡改、软件失败日志、Python 汇总边界、检索集漂移、DRC 待复核、报告哈希破坏、外部目录链接与损坏 JSON。

相关入口：[工作台验收](workbench-v07-acceptance.md) · [RAG 与 SOP](knowledge-and-sops.md) · [Agent 工作流与 trace 合同](agent-workflow-and-trace-contract.md)。
