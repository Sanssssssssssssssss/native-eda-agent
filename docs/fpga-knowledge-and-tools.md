# FPGA 知识与工具基座

已建立 36 条可检索知识、21 个官方来源、11 项工具状态及 4 个 Pi skills。主要入口是 `eda_knowledge`；计划、执行和回看分别使用 `eda_benchmark`、原生 EDA 工具、`eda_trace` / `eda_runs`。知识检索和静态检查不能替代仿真、形式验证、器件实现或板级验证。

| 内容 | 文件 |
|---|---|
| 原子规则及适用边界 | [rules.json](../knowledge/rules.json) |
| 原链接、版本、license、核验 UTC | [sources.json](../knowledge/sources.json) |
| 本机状态和接入建议 | [tools.json](../knowledge/tools.json) |
| 规划 / RTL 验证 / 时序排查 / 复现 | .pi/skills (local/optional evidence; see results/catalog.json) |
| 离线检查与负向测试 | [check-knowledge.mjs](../scripts/check-knowledge.mjs)、[knowledge.test.mjs](../tests/knowledge.test.mjs) |

AMD 基线使用本机 Vivado 2020.2 对应的 [UG903](https://docs.amd.com/api/khub/documents/qfSFSG1429Fdy4AW8zDF3A/content)、[UG906](https://docs.amd.com/r/2020.2-English/ug906-vivado-design-analysis/Report-Clock-Domain-Crossings) 和 [UG949](https://docs.amd.com/r/2020.2-English/ug949-vivado-design-methodology/Synchronous-Reset-vs.-Asynchronous-Reset)。[UG901 2020.2](https://docs.amd.com/v/u/2020.2-English/ug901-vivado-synthesis) 本轮核验了官方版本页，PDF 正文端点未成功读取，因此没有从未读正文生成细节规则。

规则覆盖复位、CDC、时钟/约束、握手、setup/hold、组合与时序编码、位宽/有符号算术、X 传播、形式验证、负控和复现。源文规范、推荐做法及本项目工程推导分别标注。特别保留以下边界：

- AMD FPGA 推荐按资源推断考虑同步复位；[lowRISC 风格](https://github.com/lowRISC/style-guides/blob/9c15ff5dce23eef969e00ab3715153967419eadd/VerilogCodingStyle.md) 的低有效异步复位来自其标准单元约定，两者不能直接互换。
- `report_cdc` 是结构分析；clock groups/false path 关闭分析后，跨域协议仍需验证。
- [Verilator](https://verilator.org/guide/latest/languages.html) 主要采用两态语义；其通过结果不证明四态未知传播。
- [SBY](https://symbiyosys.readthedocs.io/en/latest/reference.html) 的 bmc、prove、cover 分开记录；有限深度、超时和未运行均不能写成无界证明。

本机核验范围为当前 PATH、当前 Python 和指定工作区文件。已检出 Vivado 2020.2；后续独立集成核验通过 Pi 的 MCP list 实际发现 `eda-local` 9 个工具和官方 LTspice 18 个工具，未调用模拟工具。原始返回见 mcp-discovery.json (local/optional evidence; see results/catalog.json)。Verilator、Yosys、SBY、FuseSoC、Bender 未在当前 PATH 检出；cocotb、Edalize、FuseSoC 未在当前 Python 检出。

[Ross](https://github.com/Xilinx/ross-ai-assistant/tree/2cdc9eef1b6b5b17fa45f5e4d468e5483a1c92de) 本地是 2026.9.1 文档仓库，未声称 Ross 二进制或 MCP 已连接。其中 timing-methodology skill 要求 Vivado 2026.1+，不能原样套用到 2020.2；例如新版 JSON 报告选项要先核对本机帮助。

建议按实际缺口增量接入：

1. 优先增加锁定版本的 Verilator lint，保存诊断、命令及局部 waiver；继续使用现有 XSim/Vivado 验证功能与器件结果。
2. 需要 Python scoreboard 时引入 [cocotb](https://docs.cocotb.org/en/v2.1.0/simulator_support.html)，先选择已列出的模拟器并做最小桥接测试。所核验列表没有 XSim，不能假定直接兼容。
3. 对 FIFO、握手和计数器使用小范围 [Yosys](https://yosyshq.readthedocs.io/projects/yosys/en/latest/introduction.html) + SBY + solver，先验证语言/原语支持与正负控，再扩大性质集合。
4. 多 IP、多目标的清单维护成为实际负担时评估 [FuseSoC](https://fusesoc.readthedocs.io/en/stable/user/introduction.html) + [Edalize](https://edalize.readthedocs.io/en/latest/)；只需要 HDL 依赖与有序源文件时评估 [Bender](https://github.com/pulp-platform/bender/tree/v0.32.1)。不同时铺设重复管理层。

本轮只新增知识、skills 与离线校验，没有安装上述工具或启动大型 EDA/模型实验。验证命令为 `node scripts/check-knowledge.mjs`、`node --test tests/knowledge.test.mjs`；初次验证 [回执](../knowledge/validation-receipt.json) 保留了 8/8 测试、文件哈希及工具探测失败重试。SDK loader-result.json (local/optional evidence; see results/catalog.json) 记录真实加载 4 个 skills、零诊断和参数正负例；该次未创建模型 session。哈希不能反推历史输入已被冻结。外部模型 API 调用数为 0；Codex token 由独立会话 usage 记录统计。
