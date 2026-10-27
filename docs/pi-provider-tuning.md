# Pi 提供商与长任务配置

使用安装的 Pi 1.4 原生设置和会话接口；不引入第二套请求重试或压缩实现。仓库默认关闭模型 API，以下是本机授权实验配置，不能据此推断提供商支持程度或费用。

固定 verifier 任务只向模型声明 12 项文件、知识和任务检查工具。宿主仍持有完整注册表并执行冻结 workflow；普通探索会话保留全部工具。源码见 [agent-session](../src/agent-session.mjs)，实际 SDK 的离线检查见 [pi-sdk-dispatch](../tests/pi-sdk-dispatch.test.mjs)。工具选择用于减少无关上下文，写入边界仍由准入守卫执行。

DeepSeek 阶段本机 `.pi/settings.json` 使用：

```json
{
  "defaultThinkingLevel": "off",
  "cacheWarming": "off",
  "retry": {
    "enabled": true,
    "maxRetries": 1,
    "baseDelayMs": 2000,
    "provider": { "maxRetries": 0, "timeoutMs": 300000 }
  },
  "httpIdleTimeoutMs": 300000,
  "compaction": {
    "enabled": true,
    "reserveTokens": 32768,
    "keepRecentTokens": 8000,
    "modelOverrides": {
      "commandcode/deepseek/deepseek-v4-flash": {
        "reserveTokens": 900000,
        "keepRecentTokens": 20000
      }
    }
  }
}
```

该模型本机登记窗口为 1,000,000 token；override 将原生压缩触发点提前到约 100,000。`reserveTokens` 在这版 Pi 用于触发阈值，不代表请求生成 900,000 token 摘要。窗口与提供商能力需要各自核对，不应原样套用其他模型。

本机模型登记的兼容项为 `{"maxTokensField":"max_tokens","thinkingFormat":"deepseek"}`。真实请求已发送 `thinking: {"type":"disabled"}`，但响应仍有 reasoning token，故**未证明提供商真正关闭推理**。请求模型名与响应模型名也可能不同，两者都应记录。不要添加没有提供商依据的参数来掩盖差异。

后续为处理反复中断，在同一 CommandCode 接口检查替代模型。模型目录可见不代表套餐允许：两个 GPT 探针均被 `MODEL_NOT_IN_PLAN` 拒绝，没有启用额外付费。`Qwen/Qwen3.8-Max` 文本探针可用，但完整请求返回不接受 `developer` 角色；使用 Pi 原生 `{"maxTokensField":"max_tokens","thinkingFormat":"qwen","supportsDeveloperRole":false}` 后，带 system 消息和工具的探针完成。Qwen 的原生压缩 override 仍使用 1,000,000 窗口、900,000 reserve 和 20,000 recent；请求的 `enable_thinking:false` 同样不能证明服务端完全没有推理消耗。所有探针和失败保留在同一累计台账。

Qwen 的完整修复请求仍多次中断，随后同一接口的 `z-ai/glm-5.3-flash` 工具探针以 191 token 完成，回执 reasoning 为 0。登记使用 Pi 原生 `thinkingFormat:"zai"`、`supportsDeveloperRole:false`；窗口依据当时的提供商目录为 1,048,576，压缩 reserve 为 948,576。探针只能证明该次兼容性；具体任务是否成功须查看对应 verifier 和在线评测。

实验中发生过 90 秒首次响应超时及 HTTP 200 后流中断。重试必须有界，缺少 usage 的请求继续占用保守预算预留。流未完整结束、工具编辑未落盘时不能记作成功响应。实验计量器对本地预算拒绝返回明确的本地错误，并记录 `upstream_dispatched:false`，避免 SDK 将其包装成含糊的连接错误；该计量器只用于本机实验。

这些设置解决已有兼容性和可观测性问题；不能从一次成功推断消除了网络故障。会话验收仍执行 [固定任务闭环](agent-lifecycle.md)，已知 token、未知用量预留和外层 Codex 用量分别报告。

后续源码核对发现：本机 OpenAI SDK 的 `fetchWithTimeout` 在收到响应头后清除计时器。上述 300 秒配置不能保证中途停流的响应体会被关闭；框架的整场会话截止仍独立生效。本机实验计量器因此使用 Node 原生 `AbortSignal.timeout` 与调用者 signal 组合，给完整请求设置 300 秒截止，不增加另一套重试。仅本机 HTTP 服务的故障探针验证了响应头后停流与主动取消，两种情况均保留未知用量预留。这是实验传输层的保护，不能宣称发布框架已有每条响应体的空闲检测。

[CommandCode 官方 Provider 文档](https://commandcode.ai/docs/provider)说明 Chat Completions 流会在末尾提供 usage。本轮缺失终态与 usage 的响应按不完整记录处理；官方页面没有提供足以证明关闭推理或消除本次中断的额外设置。
