---
name: fpga-reproduce
description: Inspect, reproduce, and compare an FPGA experiment from retained input snapshots, tool manifests, logs, and run status. Use for trace audits, regression reproduction, or historical result reconciliation.
---

# Reproduce an experiment

从明确的 run 目录开始；`latest-*.json` 只是入口。先用 `eda_runs({action:"list"})` 和 `eda_trace({directory:"..."})` 检查历史结果、终态及输入。需要协调陈旧 running 状态时用 `eda_runs({action:"reconcile"})`，保留原记录与处理依据。

1. 读取 run.json、events.jsonl、process.log、结果与报告。区分 failed、timeout、interrupted、running、missing；保留同一任务的失败尝试。
2. 用 `node scripts/replay-experiment.mjs "artifacts/.../run.json" --check-only` 核验已捕获输入。检查 input_drift、未解析依赖、工作目录、原始 arguments；此命令不检查所有外部环境。
3. 核对实际工具版本、part、约束、seed、solver/仿真选项和外部 IP/文件。准备好当前任务范围内的复跑后，用同一脚本 `--run` 创建独立实验。它使用当前工作区匹配后的输入，不自动恢复历史源文件；路径搬迁或文件漂移需先处理并如实记录。
4. 用 `eda_benchmark({action:"compare",baseline:"...",candidate:"..."})` 比较基准实验；系统证据另可用 `python scripts/collect-system-evidence.py` 归档索引。只对已支持的目录格式使用 compare，未知格式逐项读原报告。
5. 保留输入/命令/环境/关键日志和报告的路径、SHA-256、捕获 UTC。大波形按需要索引。历史采集 hash 不代表当时已冻结，也不保证复跑比特相同。

先识别恢复类型：多工具任务用 `eda_workflow_resume_check/resume`；物理优化器用 `eda_trace action=recovery-check` 后传 `resume_from`；上述 replay 脚本只处理其支持的原生调用。检查所有者和已提交边界，恢复创建新目录。查询历史成绩用 `eda_results_verify/compare`，保留不可比原因。各入口见 [workflow](../../../docs/workflows.md) 与 [成绩](../../../docs/results.md)。

输出复跑是否完成、差异、证据目录与复现边界。原生工具/model API 调用数与 Codex token 分开报告；未知 token 写 unavailable，不能写 0。

Knowledge IDs: FPGA-TRACE-001, FPGA-FORMAL-001, FPGA-NEGATIVE-001, FPGA-TIMING-001.

Local references: [rules](../../../knowledge/rules.json), [replay CLI](../../../scripts/replay-experiment.mjs), [collector](../../../scripts/collect-system-evidence.py), [trace design](../../../src/trace.mjs).
