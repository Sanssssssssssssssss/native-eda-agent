# 仓库结构与本地工作区

正式 Git 仓库是 `native-eda-agent-public/`。维护者的 `EDAAgent/` 是包含运行环境、会话和原始实验产物的本地开发工作区；通过显式导出更新正式仓库。公开克隆可直接开发、运行离线检查，不需要另建开发工作区。

## 源码与可公开证据

| 目录 | 内容 |
|---|---|
| `src/` | Pi 入口、verifier 闭环、workflow、工具注册、资源调度与 trace |
| `scripts/` | 安装、验证、离线演示、成绩检查和发布导出 |
| `tests/` | 软件合同、失败边界与假 EDA 检查 |
| `web/workbench/` | 会话、工程资产、任务与分类评测界面 |
| `knowledge/`、`.pi/skills/` | 带来源的规则、检索回归、SOP 与操作步骤 |
| `examples/`、`projects/` | 固定任务规格、verifier 配置和可分发工程源码 |
| `benchmarks/`、`results/` | 测试协议、历史成绩与脱敏证据 |
| `vendor/` | 运行所需的固定上游源码与许可证；只分发清单中的依赖 |
| `docs/` | 当前使用与机制指南；`history/` 保留历史研究和验收，`reference/` 存工具合同与来源索引 |
| `release/` | 导出清单、依赖版本与可公开验收回执 |
| `.github/` | CI 与协作模板 |

[工作流与 trace 合同](agent-workflow-and-trace-contract.md)、[历史协作入口](agent-framework-and-traces.md)保持稳定路径。历史报告保留当时的协议、失败和数字；新机制及当前源码状态以指南和新回执为准。

## 本地数据

`node_modules/`、`runtime/`、`downloads/`、`artifacts/`、`output/`、`.eda-state/` 和 `.pi-state/` 由本机生成，受 `.gitignore` 管理。模型凭据、本机 MCP 配置、完整会话、安装包、波形、DCP 和 bitstream 保留本地。源码备份也放在 `artifacts/`，清单记录原路径和哈希。

公开证明放在 `results/` 或 `release/`，同时注明协议、假后端/真实 EDA 范围以及原始证据哈希。历史 Markdown 中的本机证据链接在导出时会标记为本地可选证据；这类标签不构成公开验收证明。

## 维护与同步

1. 在开发工作区修改源码并保留需要的基线，运行相关检查和 `npm run validate:agent`。
2. 用 `node scripts/build-public.mjs EMPTY_DIRECTORY` 导出到一个新的空目录。导出只包含允许分发的源码、许可证和收据，并生成来源清单。
3. 在导出目录按 README 安装依赖、执行本地设置及离线验收，核对文档链接、依赖和结果范围。
4. 将核验后的导出同步至正式 Git 工作树，审阅 `git status` 与 diff 后提交；发布使用正式仓库的远程地址。

导出不会自动提交、推送或覆盖已有目录。同步时按导出清单处理源码，保留正式仓库的 `.git` 与本地数据；历史实验产物继续保留在开发工作区。

```powershell
npm run repository:check
npm run release:export -- EMPTY_DIRECTORY
npm run release:sync -- EXPORTED_DIRECTORY GIT_DIRECTORY
npm run release:sync -- EXPORTED_DIRECTORY GIT_DIRECTORY --apply
```

同步默认只打印计划。`--apply` 要求目标 Git 工作树干净，核对导出字节并逐个备份原件后写入；只退役已迁入 `docs/history/` 的旧文档路径，保留未列出的历史发布回执。同步不自动提交或推送。

日常操作见[贡献规范](../CONTRIBUTING.md)，闭环用法见 [ACE-RTL 接入](ace-rtl-adaptation.md)，验收收据见 [release](../release/README.md)。
