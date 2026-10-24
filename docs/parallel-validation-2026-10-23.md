# 并行验证与 Trace 整理

**四个系统工程的功能仿真、100 MHz OOC 布线及负控均已收齐通过证据。** 原聊天负责系统集成与测试，本聊天另开三个子 Agent，完成独立基础回归、trace 实现/审查和系统证据核验。协作通知已于新加坡时间 2026-10-23 02:27 通过用户授权的 Codex 界面送达原聊天，并在目标会话日志确认。

| 系统工程 | 功能结果 | Setup / Hold 余量 |
|---|---|---|
| RISC-V SoC | 8 组固件运行，40 项算法结果 | +2.404 / +0.120 ns |
| AXI DMA | 717 场景，3,064,242 字节核验 | +2.105 / +0.075 ns |
| UDP / IPv4 / ARP | 65 发 + 65 收，坏包、ARP 和复位检查 | +1.899 / +0.075 ns |
| AES-128/256 | 532 个加解密块，20 组密钥 | +1.084 / +0.105 ns |

四项故意破坏数据的负控均正确拒绝。[原工程报告](system-projects-2026-10-23.md)列出规模、覆盖边界、源码来源、耗时和截图。独立索引 (local/optional evidence; see results/catalog.json)包含 **31 次留存运行、411 个文件索引**：13 次通过、14 次历史失败、4 次预期负控。失败与后续成功分别保留；各类场景不能合并成统一题数。

本聊天完成的验证：

- 基础回归 (local/optional evidence; see results/catalog.json)：93.049 秒，counter 321 次检查、100 MHz OOC、RC 四项测量通过；63 个新工具产物已建立哈希索引。
- Trace 真实验收 (local/optional evidence; see results/catalog.json)：24.479 秒，counter 成功、多分析网表正确拒绝、坏 RTL 正确编译失败；逐例核对回执、事件顺序、UTC、进程状态和快照，索引 138 个文件。
- 实际复跑 (local/optional evidence; see results/catalog.json)：RC AC 原始运行和检查哈希后的新运行，均测得截止频率 **1591.54950775 Hz**、1 kHz 增益 **0.846733015964371**；两次测量一致且满足原 0.2% 阈值。
- 统一检查 (local/optional evidence; see results/catalog.json)：`npm test` 通过 **17 项 Node 测试、12 项 Python 测试**及原有 RC 日志解析断言。Pi 会话初始化失败、SDK 取消、重试恢复和关闭失败用离线替身验证，没有启动真实模型 API。

新增能力见 [Agent 框架与实验追踪](agent-framework-and-traces.md)：每次原生调用保存参数、进程、命令、起止时间、失败原因、输入字节快照和 SHA-256；Agent 事件关联会话/工具调用并保留重试历史。历史采集器和复跑器都有独立入口，所有结果留在原目录。

修正记录也保留：独立审查发现的关闭终态不一致、SDK aborted 漏判、自动重试恢复误判、无窗口内用量观测却返回零等问题已修复并加入测试。CLI 输入拒绝测试两次因模块加载超过 15 秒而失败；该启动等待改为 60 秒，实际 EDA 超时与设计验收标准未改变。首次整合失败日志 (local/optional evidence; see results/catalog.json)未覆盖。

用量按两组分别记录：本聊天与三个子 Agent 的 Codex 计数快照 (local/optional evidence; see results/catalog.json)；原工程聊天的 已有用量收据 (local/optional evidence; see results/catalog.json)。其他模型 API 调用为 0；这不代表 Codex tokens 为 0。快照只覆盖各自最后已写入事件，推理/缓存分别包含在输出/输入中，不能重复相加；未推算费用。

边界：这是开源核心的本机集成评测，未上板。AES 遇到多次 Vivado 初始化文件读取异常后由独立 batch 完成，根因仍未确定。历史缺失信息无法补回；新 trace 的静态依赖扫描可能不完整，仍执行原工作区路径，以输入快照、前后哈希和 unresolved 记录说明可复现范围。
