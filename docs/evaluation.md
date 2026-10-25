# 分类评测与计分

评测分为离线软件/检索/证据、真实 EDA 工具流程、真实 Agent 会话任务。协议、单位和分母独立；没有合并总分。`npm run workbench` 提供同一套入口。

| 套件 | 分类与单位 | 检查内容 |
|---|---|---|
| `offline-contracts` | 离线 / 软件检查 | 假 EDA、本机进程、MCP、目标验收、预算、恢复与会话保存；调用完整 `validate:agent` |
| `offline-retrieval` | 离线 / 可见问题 | 24 条中英文回归、Hit@5、MRR@5、3 条无关查询；保留旧 AND 检索对照 |
| `offline-evidence` | 离线 / 历史成绩记录 | 11 组公开副本与可取得原件的哈希；原件缺失单独报告 |
| `online-counter` | 真实 EDA / 工作流 | XSim、固定 checker、精确标记及独立功能验收 |
| `online-axi` | 真实 EDA / 工作流 | AXI 仿真→综合→布线→DRC；固定器件和 100 MHz 时钟、逐领域验收 |
| `online-agent` | Agent 端到端 / 会话任务 | 已有 Pi SDK 会话、输入快照、终态、直接关联 workflow 的 trace/span 与工程目标 |

这里的 online EDA 指实际运行 EDA 工具，不要求网络或模型。`online-agent` 是已有会话的验收入口，不会启动模型提供商；缺目录记 blocked，证据不满足记 failed。它只证明这一次已记录会话与工程目标，不证明模型一般能力、盲测或独立参考质量。

```powershell
npm run evaluate -- list
npm run evaluate -- plan online-axi
npm run evaluate -- run offline-retrieval
npm run evaluate -- run offline-contracts
# 下面会启动真实 XSim / Vivado，需要安装、许可证和固定依赖
npm run evaluate -- run online-counter
npm run evaluate -- run online-axi
# 只核验已有会话，路径替换为实际目录
npm run evaluate -- run online-agent --session artifacts/NATIVE_AGENT --workflow artifacts/CHILD_WORKFLOW
```

每次生成独立 `artifacts/evaluation-*/result.json`，记录 suite、lane、category、unit、起止时间、状态、协议/知识文件哈希、指标与证据目录。真实任务的工具代码、RTL/XDC 与产物哈希由其 workflow/子 trace 记录。离线软件日志中的检查数不得记作 FPGA 工程数；原件一致不得记作重新实现通过。

界面同时展示记录时的结果和当前源码是否匹配。该标记只覆盖回执记录的文件；要判断 workflow 证据与输入是否仍可用，执行 `workflow inspect`。未运行、前提缺失、失败和待审查不会自动变为 passed。

## 当前验证边界

本轮真实 Counter 验证固定 `COUNTER_PASS`，321 次检查、1 次回绕、7 次保持、3 次复位；只覆盖功能 profile。真实 Ethernet DCP 的 DRC 查询得到 0 error、0 critical warning、2 warning，按严格策略需要审查。这两项与历史 11 组成绩分别记录。完整发布回执见 [release](../release/README.md)，AXI 本轮结果见 [功能成绩](results.md)。

模型 API 当前停用；评测器提供商调用为 0。没有新真实 Agent 端到端分数，没有独立盲测/答案忠实度结果。外层 Codex token 未计量，不能由 0 个提供商调用推算为 0 token。

协议或验收变化后另建运行，保留旧失败。改时钟、放宽 watchdog、替换 checker 或更换 DUT 参数后的成绩不可直接当作同一协议的提升。SOP 自然语言遵循率目前没有自动评分器。

完整离线机制回归中的代理测试也使用该工作区的资源租约。应在没有真实 Vivado 任务占用资源时运行，或使用独立 checkout；与长时间实现并发会因等待资源触发测试时限。本轮保留了这一超时记录，真实 AXI 完成后，同一套回归 111 Node + 21 Python 全通过，未放宽测试时限。
