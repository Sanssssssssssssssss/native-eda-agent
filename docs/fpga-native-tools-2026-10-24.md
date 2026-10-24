# 面向复杂 FPGA 工程的原生工具

本地 MCP / Pi 工具目录由 9 项增至 **15 项**。新增 6 个 Vivado 专用操作，并增强 XSim 参数化仿真；当前 Codex 可直接经 CLI 或 MCP 使用，全程无需额外模型 API。AMD ROSS 的官方 MCP 仍未连接。

[实际验收与限制](fpga-native-tools-validation-2026-10-24.md)：12 项工具集成检查通过，AXI 完成功能仿真、综合和 100 MHz OOC 布局布线，全部 trace 核验通过。

| 工具 | 工程输入与结果 |
|---|---|
| `eda_vivado_catalog` | 查询本机版本、器件、IP VLNV 和命令；返回总匹配数与有上限的列表 |
| `eda_vivado_synthesize` | RTL/XCI、top、part、XDC、宏和参数 → 综合 DCP、利用率、时序、黑盒数量 |
| `eda_vivado_implement` | 综合 DCP、可选附加 XDC → opt/place/route、布线 DCP、时序与约束检查 |
| `eda_vivado_reports` | DCP → timing、utilization、CDC、DRC、methodology、clocks、exceptions、route 报告 |
| `eda_vivado_objects` | 按模式查询 cell/net/port/pin/clock，返回对象属性与总数量 |
| `eda_vivado_timing_paths` | 查询 setup/hold 路径、起终点、slack、requirement、逻辑级数；可按确切时钟名筛选 |
| `eda_xsim` 增强 | 显式 Verilog/SystemVerilog/VHDL、include_dirs、defines、generics、libraries、plusargs、sv_seed、超时与 PASS 标记 |

综合默认 OOC；器件和 XDC 必须来自任务。接口不会自行创建时钟、放宽周期、增加 false path、忽略断言或生成 bitstream。所有输出位于新 artifact；已有项目和历史 benchmark 指针不因调用而改写。Vivado 并发仍为 1，XSim 为 2。

## 使用

```powershell
cd ${WORKSPACE}
node scripts/eda-tool.mjs eda_vivado_catalog projects/fpga-tool-validation/catalog.json
node scripts/eda-tool.mjs eda_xsim projects/fpga-tool-validation/xsim-options.json
# 整套真实工具验收，包含 AXI 综合与布线
node scripts/validate-fpga-tools.mjs
```

综合输入形式：

```json
{
  "sources": ["projects/my-design/top.sv"],
  "top": "top",
  "part": "xc7a100tfgg676-2",
  "constraints": ["projects/my-design/top.xdc"],
  "include_dirs": ["projects/my-design/include"],
  "defines": ["FPGA=1"],
  "generics": ["DATA_WIDTH=32"]
}
```

上面的 `my-design` 是待替换的路径示例。将返回的 `fpga.artifacts["synthesized.dcp"]` 作为 `eda_vivado_implement` 的 `checkpoint`。之后用路由 DCP 调用报告、对象和路径工具。参数 JSON 支持绝对路径或本工作区相对路径；输入必须位于本工作区。

新连接的 MCP 客户端已发现 15 项工具。当前聊天若缓存了旧目录，重新连接 `eda-local` 或打开新会话后更新；CLI 可立即使用。Pi 原生扩展与 MCP 共用同一注册表。

## 判定与证据

每次调用返回 `run.json` / `events.jsonl` / `process.log`；Vivado 另保留生成的 Tcl、原始报告、DCP/XDC 和 `fpga-summary.json`。输入与执行器保存 SHA-256，取消和失败保留回执。验收脚本在独立目录保存每项参数、耗时和实际调用路径。

`assessment` 分别标记 setup/hold、内部时钟约束、IO 约束、CDC 和布线状态。缺少报告或不识别的格式保持 `unknown`。CDC Warning 和缺失 IO 延迟保持 `review_required`；DRC/methodology 的完整严重性和说明保留在原始报告中。有限路径列表的全设计 TNS 为 `null`。没有综合“全设计通过”结论。

XSim 的 `simulation_acceptance` 要求唯一的指定 PASS 行、完成标记且无 Fatal/Error/Timeout；未提供 `pass_marker` 时是 `not_evaluated`。这些检查验证测试台是否正常完成，测试台本身仍需独立 oracle 和覆盖门。多次 seed / 参数运行属于同一工程的覆盖量。

IP catalog 查询已接入；XCI 读取入口不替代 IP 配置、输出产品生成或仿真库编译。复杂 IP 工程仍可使用 `eda_vivado` 的项目 Tcl 流程。VHDL 文件按显式清单顺序编译，再编译 Verilog；循环依赖与额外逻辑库需项目级流程。时序、CDC 结构报告和 OOC 实现均不能证明板级 IO、亚稳态 MTBF 或硬件行为。

实现入口：[fpga.mjs](../src/tools/fpga.mjs)、[Vivado Tcl](../src/tools/vivado-common.tcl)、[XSim 参数](../src/tools/xsim-options.mjs)。既有[框架与 trace](agent-framework-and-traces.md)、[并行协作记录](parallel-coordination-2026-10-23.md)继续适用。
