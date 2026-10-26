# 按功能查看成绩

最新本机复测：[A7-100T 8/8 工程验收](a7-eight-projects.md)，7/7 Pi 会话证据评测及 301 项离线测试。使用新的固定 OOC 集成条件，下列历史协议和数值保留。

历史索引含 **11 组记录**，覆盖 RTL、系统集成、工具执行、优化与软件验收。[catalog.json](../results/catalog.json) 保存协议、限制、原文件哈希与公开证据哈希；下列 FPGA 结果没有在本次文档与知识改造中重跑。

## RTL 功能与负控

| 任务 / 索引 ID | 结果 | 计分和限制 |
|---|---|---|
| `verilogeval-8-original` | 7/8 | 固定可见题；诊断修复不能覆盖原成绩 |
| `verilogeval-24-original` | 20/24 | 原 watchdog 1,000,000 ps；保留超时 |
| `verilogeval-24-extended` | 23/24 | 同一批 RTL，0 处 RTL 改动；watchdog 10,000,000 ps，仍有 1 项参考结果不一致 |
| `campaign-61-frozen` | 51 PASS、1 FAIL、6 TIMEOUT、2 EXPECTED_FAILURE、1 EXPECTED_TIMEOUT | 48 个家族、61 个 case variants；后续单独复跑不抹去该批超时 |

题目可见且经过人工选择，因此没有盲测 pass@1。8 题、24 题、61 variants 存在任务重叠；两种 watchdog 协议也不能直接合计。详见 [24 题报告](history/codex-verilogeval-24-2026-10-23.md) 与 [benchmark 目录](benchmark-catalog.md)。

## 系统工程、数值检查与实现

下列结果来自 Vivado 2020.2 的固定约束 OOC 实现与各自功能 checker，setup/hold 单位为 ns。Slack 和资源只在原器件、约束、阶段下解释。

| 工程 | 功能 / 实现 | Setup / Hold | Slice LUT / FF | RAMB36 / RAMB18 |
|---|---|---|---|---|
| SoC | 通过 / 通过 | 2.404 / 0.120 | 1884 / 1265 | 16 / 0 |
| DMA | 通过 / 通过 | 2.105 / 0.075 | 914 / 584 | 1 / 0 |
| UDP | 通过 / 通过 | 1.899 / 0.075 | 1599 / 2924 | 1 / 0 |
| AES | 通过 / 通过 | 1.084 / 0.105 | 3195 / 2903 | 0 / 0 |
| AXI 3×3 fabric | 通过 / 通过 | 2.109 / 0.058 | 2008 / 2014 | 8 / 0 |
| 三时钟 Ethernet | 通过 / 通过 | 2.510 / 0.073 | 1896 / 2964 | 7 / 2 |
| RV32IM AES DMA | 通过 / 通过 | 0.518 / 0.096 | 5110 / 4866 | 16 / 0 |

前四项为 `system-projects-4`；后三项为 `hard-projects-3`，各有命中特定 checker 的负控。Ethernet 留有 **34 条 CDC warning**，不宣称 CDC 签核。报告：[四系统](history/system-projects-2026-10-23.md)、[复杂系统](history/hard-system-projects-2026-10-23.md)。这些工程集成了固定版本的开源 IP，没有从零生成整个 IP 或板卡实测的成绩。

`fft-1024`：厂商 FFT IP 与本地 wrapper，16 帧 × 1024 点，共 16,384 个频点与独立数值参考比较；4 项负控。100 MHz OOC setup +1.6425 ns、hold +0.0459 ns。频点数是检查覆盖量，计分单位是 1 个系统工程。

## 原生工具与工程装配

| 功能 / 索引 ID | 结果 | 实际含义 |
|---|---|---|
| `native-integration-12` | 12/12 工具检查 | 6 类原生操作，涵盖 catalog、综合、实现、报告、对象与时序路径；复用已有工程 |
| `workbench-integration-33` | 33/33 工具检查 | 13 类工程、IP、Block Design 操作；不是 33 个新设计 |

原生集成中的 AXI 运行：4 个种子，读写各 2,328 个 burst、37,824 个 beat，658,158 次协议检查；setup +2.393 ns、hold +0.058 ns，3,159/3,159 可布线网络完成，routing errors=0。它与上表的原始 hard-bench 运行有独立记录，不能覆盖原值。诊断结果仍为 `overall_design_acceptance=not_evaluated`、CDC unknown、board_signoff=false。

详见 [原生工具验收](history/fpga-native-tools-validation-2026-10-24.md) 与 [Workbench 覆盖](vivado-workbench-coverage-2026-10-24.md)。生成 DRC 报告只证明报告生成；历史记录没有把它升级为“DRC 为零”。v0.6 workflow 另行核验严重级别计数；旧记录不补造该字段。

## 物理优化

`optimizer-axi-smoke`：Explore / AggressiveExplore 共 2 个候选，接受改进候选 0 个，**WNS 收益 0 ns**；原输入不变，最终复测通过。7 个本地物理策略仅这 2 类有真实运行验证；上游 42 项 playbook 是参考目录。本项目未复现 FPL 排名，也未证明优化平均收益。

该历史运行早于新恢复与 trace 实现，保留原证据能力。机制见 [优化器](native-optimizer-2026-10-24.md)。

## LTspice 模拟电路

[2026-10-22 原始报告](validation.md)记录 RC AC 与瞬态四项测量：截止频率 1591.5495 Hz、1 kHz 增益 0.846733、100 μs 输出 0.632118 V、1 ms 输出 0.999955 V，均通过相对误差 <0.2% 的解析解检查。这是基础 RC 案例，未纳入上述 11 组结果索引；代理更新后没有重新执行真实 LTspice bridge。

## 知识、SOP 与框架软件

当前检索回归为 24 条人工可见问题，Hit@5 从旧查询的 **3/24** 提升到 **24/24**，MRR@5 为 0.9583；3 条无关问题均返回空。软件检查覆盖中英文问题、来源过滤、SOP 读取、缺失文件、知识变更阻止续跑和真实 Pi 资源发现。检索成绩不衡量模型回答或设计正确率。[方法与边界](knowledge-and-sops.md)，可运行 `npm run knowledge:eval` 重现。

`npm run validate:agent` 检查本机资源调度、MCP、trace、恢复、固定验收与知识合同。当前发布回执见 [release](../release/README.md) 和 GitHub Actions，使用假 EDA、本机子进程和资源加载，不启动模型会话。历史索引 `agent-offline-20261024` 的 64/64 保留原版本；不可累计为当前软件测试总量或 FPGA 新成绩。

## v0.6 本机验证

新增真实 Counter workflow：321 次检查、1 次回绕、7 次保持、3 次复位；功能目标通过。真实 Ethernet DCP 报告查询：DRC errors=0、critical_warnings=0、warnings=2，属于需要审查的物理证据。工具调用成功与 DRC 完全通过分别报告。

AXI 3×3 完整 workflow 在 Vivado/XSim 2020.2、`xc7a100tfgg676-2`、100 MHz 下运行约 155 秒：4 个种子，读写各 2,328 burst、37,824 beat，658,158 次协议检查；setup **+2.393 ns**、hold **+0.058 ns**，3,159/3,159 可布线网络完成，零黑盒。功能、综合、setup、hold、约束、routing 六项通过；DRC 为 0 error / 0 critical / **2 warning**（CFGBVS-1、RTSTAT-10），整体 `acceptance_review_required`，严格评测不计通过。CDC 未要求，formal/板卡未评估；不填写或猜测板卡配置电压来消除警告。

该运行复用了已公开的 AXI 工程和 checker，证明新增 workflow/目标核验实际接通；不是新盲测设计，也不是新的性能提升。原始目录为 `artifacts/2026-10-25T11-38-24-464Z-eda_workflow_run-9a7a5467`，评测回执为 `artifacts/evaluation-2026-10-25T11-38-24-457Z-52c3ff/result.json`。公开包保留脱敏结果及原件哈希，DCP/波形留在本机。

分类评测、当前软件/检索回执与用量见 [评测协议](evaluation.md) 和 [发布回执](../release/README.md)。没有新模型 Agent 端到端分数；历史 11 组结果保持原样。

## 查询与复核

```powershell
node scripts/results.mjs list
node scripts/results.mjs get hard-projects-3
node scripts/results.mjs verify hard-projects-3
```

原生接口为 `eda_results_list/get/verify/compare`。`verify` 检查公开文件和仍可找到的原文件；公开仓库未分发 DCP、波形和大型运行目录，原件 `unavailable` 表示缺少原件，并不表示独立复现。哈希检验一致性，不是数字签名或第三方证明。

`compare` 要求 task_set、protocol、scope、unit 一致且证据完整，否则拒绝 pass_delta。不同计分单位没有总分。完整开发工作区可运行 `scripts/import-historical-results.mjs` 重建历史索引；公开 clone 直接使用现有索引。导入不运行 EDA、不补造旧 trace。
