# Agent 闭环交付

本次补齐统一 MCP 追踪、共享资源调度、优化器恢复、OTLP 导出与显式发送入口，并同步 Codex/Pi 配置。模型 API 继续停用。实现和验收针对本机 Agent 软件流程；本轮没有运行 Vivado 或 LTspice 仿真。

离线验收 **43 项 Node + 21 项 Python 全通过**，另通过配置校验；含中断恢复后测量不一致时拒绝继续的负控。完整日志与最终源码哈希见 验收索引 (local/optional evidence; see results/catalog.json)。本机 OTLP 示例导出 (local/optional evidence; see results/catalog.json)来自假后端，不是 FPGA 成绩。

| 能力 | 当前行为与入口 |
|---|---|
| 社区 MCP 追踪 | [本地代理](../src/traced-mcp-proxy.mjs)覆盖全部 45 个社区/Workbench 工具，保留 11 个 Prompt 和资源读取；每次工具调用生成统一 `run/events/receipt` |
| LTspice 接入 | Pi 配置复用同一个代理；本轮用假后端验收公共协议路径，未启动真实 LTspice bridge |
| 跨层关联 | 原生 MCP 与代理接受 W3C `traceparent` 或白名单 `eda.trace` 元数据；客户端未提供关联时创建独立 trace，不推断聊天 ID |
| 调度与失败 | 社区/原生工具共用 Vivado 资源租约；LTspice 同理。文本错误和 `ok:false` 归一为 `isError`；超时/取消关闭代理拥有的后端，后续调用要求重连；清理未确认时保留租约 |
| 优化器恢复 | 每个完成候选提交不可变恢复记录，再发布 `recovery.json`；检查进程已退出、代码/计划/DCP 哈希，从新目录重新测量基线和已保留的最佳 DCP，然后继续剩余候选 |
| 导出 | [OTLP JSON 导出器](../src/trace-export.mjs)保留层次、事件、状态、精确时间和恢复链接；不导出提示、Tcl/参数/响应正文、路径、凭据、错误正文 |
| 显式发送 | [OTLP 上传入口](../scripts/upload-traces.mjs)仅在指定 endpoint 后发送；拒绝明文远端、重定向和部分拒收，不自动重试；本轮仅连接本机测试接收端 |
| 验收入口 | `npm run validate:agent`：假 EDA 后端、真实 MCP/Node/Python 进程边界、资源调度与本机 OTLP 接收端；每次新建带日志和源码哈希的报告 |

## Agent 操作入口

先调用 `eda_preflight`、`eda_runs action=list`，按[工作流合同](agent-workflow-and-trace-contract.md)选择工具。MCP/Pi 共享现有 16 个原生接口，扩展通过 action/参数提供。

```json
{"directory":"artifacts/<run>","action":"inspect"}
```

以上传给 `eda_trace`；`action` 还支持 `recovery-check` 和 `export`，两者均不会启动 EDA。`export` 在新的产物目录生成 `otlp.json`，不会上传。

恢复实际执行使用 `eda_vivado_optimize`：

```json
{"resume_from":"artifacts/<interrupted-run>","mode":"run","max_trials":3,"max_seconds":600}
```

不同时提供 `checkpoint/first_play`，不改变原验收阈值。新预算只计算恢复段；累计候选历史保留，已完成候选跳过，中断中的候选重做。恢复继承停止策略；已完成流程应作为新实验运行，不冒充中断恢复。恢复需要新版 journal，旧历史没有该文件时会明确拒绝。

命令行对应入口：

```powershell
.\eda.ps1 trace artifacts/<run>
.\eda.ps1 recover artifacts/<run> --check-only
.\eda.ps1 export-trace artifacts/<run> --output artifacts/my-trace.json
npm run validate:agent
```

`recover --run` 才会启动真实 Vivado。也可直接运行 `scripts/recover-optimizer.mjs`、`scripts/export-traces.mjs`。导出文件使用新文件名，避免覆盖旧证据。

如需连接自己的 OTLP/HTTP JSON 接收端，明确指定地址后执行：

```powershell
node scripts/upload-traces.mjs artifacts/my-trace.json --endpoint http://127.0.0.1:4318/v1/traces
```

鉴权头只从本机 `EDA_OTLP_HEADERS_JSON` 环境变量读取，不写进配置或日志。云端和 Langfuse 实例仍需各自的 endpoint、鉴权和编码兼容验收，本次没有向外部服务发送 trace。OTLP 格式按[官方 JSON 编码规范](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding)核对；HTTP 成功但有 rejected spans 会判为失败。

## 运行边界与维护

- `.codex/config.toml` 的社区服务、`.pi/mcp.json` 的社区/LTspice 服务已经切换代理；**现有连接需要重连**。配置改前副本在 交付目录 (local/optional evidence; see results/catalog.json)。
- 租约覆盖一次 MCP 调用。代理要求 `run_synthesis`、`run_implementation` 使用 `wait=true`，沿用上游等待流程；`wait=false` 在派发前拒绝。任意 Tcl 启动异步工程后仍须 `wait_on_run` 等待完成；单凭 RPC 返回不能证明其后台工程结束。元数据、Prompt、资源读取不作为设计修改执行。实测依据见[稳定性记录](stability-2026-10-26.md)。
- 恢复从已持久化候选边界开始，不恢复 Vivado 内存或崩溃时半写的 DCP。代码变化、证据损坏、原进程仍活跃/状态未知均拒绝自动恢复；不杀其他会话来强行通过检查。
- 动态 Tcl 的完整依赖、功能形式证明、板卡结果、Ross 官方二进制/授权属于外部前提。工具完成和 trace 有效都不能代替这些证据。
- 新增的 trace、恢复、代理生命周期仍需要未来的真实 EDA 验收；历史 FPGA 成绩不因本轮软件验收而增加。

历史入口保留：[首次静态审计](history/agent-static-audit-2026-10-24.md)、[协作与 trace](agent-framework-and-traces.md)、[优化器实测](native-optimizer-2026-10-24.md)。
