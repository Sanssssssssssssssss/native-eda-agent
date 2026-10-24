# FPGA knowledge

36 条原子知识、21 个官方来源和 11 项工具/参考能力记录。JSON 可直接检索，无需向量数据库或外部服务。

- `rules.json`：`rule` 是限定范围内的要求；`recommendation` 是建议；`limitation` 说明结论边界。每条包含适用范围、版本、来源 URL/章节、所需证据和静态证明边界。
- `sources.json`：来源版本、license、核验 UTC 与核验方式。可变的 latest/stable 文档记录实际观察版本；文档与代码仓库 commit 不自动视为同一构建。
- `tools.json`：本机探测范围、可用状态及增量接入建议。未在当前 PATH/Python 检出不等于整台电脑未安装。

调用 `eda_knowledge({query:"CDC",limit:5})` 或 `eda_knowledge({id:"FPGA-CDC-001"})`。离线检查：`node scripts/check-knowledge.mjs`；负向测试：`node --test tests/knowledge.test.mjs`。

校验器只检查结构、引用和文件存在，不证明来源内容正确、在线链接可达、RTL 正确或硬件运行。应用规则时仍需工具报告、仿真/形式验证及任务要求的实际硬件证据。

来源内容均为短摘要；lowRISC 指南署名归 lowRISC contributors，原指南为 CC-BY-4.0。本项目摘要注明了工程推导项；AMD 文档仍受其原版权条款约束。完整原文保留在来源链接，不复制手册。
