# FPGA 知识与 SOP

本目录保存 36 条原子规则、21 个来源、4 个 SOP 索引，以及 11 项带原始检查日期的工具/参考能力记录。当前调用与边界见 [知识与 SOP 指南](../docs/knowledge-and-sops.md)。

| 文件 | 用途 |
|---|---|
| [rules.json](rules.json) | 要求、建议与限制；适用范围、版本、引用、所需证据、静态证明边界 |
| [sources.json](sources.json) | 来源链接、观察版本、版权/许可、原核验日期与核验方式 |
| [sops.json](sops.json) | 4 个 SOP 的触发条件、规则引用、必要证据；正文在 [.pi/skills](../.pi/skills) |
| [retrieval-cases.json](retrieval-cases.json) | 24 条可见检索回归与 3 条无关查询；不是保留盲测题集 |
| [tools.json](tools.json) | 2026-10-22 的工具探测记录；当前是否可运行还须 preflight 和实跑 |
| [routeagents-playbook.json](routeagents-playbook.json) | 42 项上游策略参考及本地适配状态；执行器仅实现 7 项 |
| [validation-receipt.json](validation-receipt.json) | 初始建设的历史回执；文件哈希对应当时版本 |

`npm run knowledge -- "跨时钟总线一致性"` 返回本地 BM25 排序、命中词项、来源和语料哈希；`npm run sop -- fpga-rtl-verify` 返回完整步骤。`npm run knowledge:check` 检查结构与引用；`npm run knowledge:eval` 生成新的检索回归回执。完整发布 CI 同时覆盖这些合同。

本地 Ross 副本标为 optional_local_paths，公开包缺少它时明确返回 unavailable；必需文件或 SOP 缺失仍会失败。校验器不访问外网，也不把路径存在当成来源正确、EDA 安装或设计通过。

来源内容为短摘要与工程推导。lowRISC 原指南为 CC-BY-4.0，署名 lowRISC contributors；AMD 文档保留其原条款。检索结果保留来源身份和适用条件；完整原文通过来源链接查阅。
