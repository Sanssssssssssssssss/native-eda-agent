# 2026-10-26 验证循环升级回执

已保留源码基线，引入固定版本 NVIDIA ACE-RTL，并将独立 verifier 接入 Pi 会话。完整离线验收 **244/244 通过，0 跳过**；模型与 EDA 本轮均未实跑。

| 证据 | 结果 |
|---|---|
| [升级前备份摘要](../../release/verifier-loop/backup.json) | 226 个文件，全部备份 SHA-256 重新核对一致；既有运行产物和环境保留原处；完整清单保留本地 |
| [固定上游](https://github.com/NVlabs/ACE-RTL/tree/94754d796350d42502c9a32639a20d86f50e9678) | vendor 原版工作树无修改；代码 Apache-2.0，混合文档另含 CC-BY-4.0 |
| [完整离线验收](../../release/verifier-loop/validation.json) | 216 Node + 21 优化器 Python + 7 ACE Python；配置、知识检查通过 |
| [真实桥接的离线闭环](../../release/verifier-loop/demo.json) | 假生成/EDA、真实 workflow/trace/Python/上游组件；failed → passed；固定 checker 保持一致 |
| [AXI 静态准入](../../release/verifier-loop/axi-plan.json) | fpga_ooc，25 个受保护输入，2 轮、16 次宿主验证调用上限 |

闭环复用同一 Pi 会话：生成候选 → 宿主验收 → 原版 ACE 反馈 → 修复 → 复验。固定测试台、约束、规格和验证代码；重复失败、需人工审查、取消或预算耗尽即停止。最终独立回读可将先前通过降为 unknown。编译失败保留可信子 trace 的有界日志诊断。

上下文钩子按当前会话分支恢复任务目录，每次请求重建目标、器件、输入摘要、预算、领域状态与最近失败。保留 Pi 默认压缩，不安装 pi-smart-compact。

额外模型 API：0；Vivado/LTspice 执行：0；外层 Codex token 未统计。上述检查不代表新的 FPGA 正确率或 PPA 收益。修改范围属于漂移检查，仍需 OS 级隔离防止通用工具任意写入。工作台 API 已支持 verifier 配置，页面暂无专用表单。

使用方法、来源和许可见 [ACE-RTL 接入说明](../ace-rtl-adaptation.md)。现有 [trace 协作入口](../agent-framework-and-traces.md) 保留。
