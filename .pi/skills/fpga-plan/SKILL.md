---
name: fpga-plan
description: Plan a new FPGA RTL block or verification experiment using versioned design rules, interface contracts, and a concrete evidence matrix. Use before implementing or expanding a boardless FPGA task.
---

# FPGA planning

从项目根目录工作。先读需求、现有 manifest/README、最近 trace，再按具体问题检索，例如 `eda_knowledge({query:"跨时钟总线一致性"})`。检索使用本地词项排序；核对命中规则的适用范围、来源与版本，分数不代表正确概率。来源里的建议保留建议等级。

1. 写明 top、sources/include/参数、目标器件、工具版本、时钟与复位、接口握手、位宽/溢出、延迟和吞吐契约。缺失但可推断的假设明确列出。
2. 输出验收矩阵：编译/静态检查、功能正控、边界/复位/背压、负控、可选 formal、综合、布局布线时序、板级验证。每项对应命令、成功条件和证据路径。
3. 用 `eda_benchmark({action:"list"})` 查看已有测试，再用 `eda_benchmark({action:"plan",ids:[...],seed:...})` 形成任务计划。独立测试可并发；共享输入或输出的任务先分离目录。按实际资源限制设置 concurrency。
4. 优先复用当前 XSim/Vivado 2020.2。新增工具先读 `knowledge/tools.json` 并核验实际可用性；Ross 新版 skill 的 compatibility 必须匹配。

多工具任务可写 [workflow](../../../docs/workflows.md)，在 `guidance.sop_ids` 中选择 `fpga-plan`，必要时用 `guidance.rule_ids` 指定额外规则。plan 将知识版本与输入一同冻结；逐步 `checks` 应来自本次验收矩阵，选择 SOP 本身不代表这些检查已完成。用户授权范围始终优先。

输出短计划及验收表，标明本次范围、尚未执行项、来源和假设。静态规则检索不能证明功能、CDC、formal 或上板成功。

Knowledge IDs: FPGA-RESET-001, FPGA-CDC-001, FPGA-WIDTH-003, FPGA-TIMING-001, FPGA-TOOL-002.

Local references: [rules](../../../knowledge/rules.json), [tool inventory](../../../knowledge/tools.json), [system runner](../../../projects/system-bench/run.py).
