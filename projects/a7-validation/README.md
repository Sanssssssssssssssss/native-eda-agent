# A7-100T 完整工程验收

8 个已有工程共用 `xc7a100tfgg676-2`。单时钟工程为 100 MHz；Ethernet 为 logic 100 MHz、RX/TX 125 MHz。固定 testbench、固件、向量、接口和时钟不参与模型修改。

| 工程 | 完整流程 |
|---|---|
| RV32IM SoC | [workflow](../../examples/workflows/a7-final-soc.json) |
| AXI DMA | [workflow](../../examples/workflows/a7-final-dma.json) |
| UDP/IP/ARP | [workflow](../../examples/workflows/a7-final-udp.json) |
| AES stream | [workflow](../../examples/workflows/a7-final-aes.json) |
| AXI 3×3 | [workflow](../../examples/workflows/a7-final-axi-fabric.json) |
| RV32IM + AES DMA | [workflow](../../examples/workflows/a7-final-crypto-soc.json) |
| 三时钟 Ethernet | [workflow](../../examples/workflows/a7-final-ethernet-cdc.json) |
| 1024 点 FFT | `node scripts/run-a7-fft.mjs`：Vivado IP 生成、XSim、独立 NumPy oracle、综合实现和反向检查 |

前 7 项使用同一 Pi SDK / 宿主 verifier 闭环；FFT 使用原生工具编排，未计为 Pi 自主修复成绩。它需要本地 Vivado 2020.2、Python/NumPy/Matplotlib，以及工程索引中固定的上游源代码。

```powershell
node scripts/fetch-example-upstreams.mjs
npm run workflow -- plan examples/workflows/a7-final-ethernet-cdc.json
npm run workflow -- run examples/workflows/a7-final-ethernet-cdc.json
node scripts/run-a7-fft.mjs
```

FFT 数值 oracle 在本轮使用 Python 3.13、NumPy 2.4.6、Matplotlib 3.11.0。运行前让 `python` 可找到这两个包（例如 `python -m pip install numpy==2.4.6 matplotlib==3.11.0`）。FFT 的可选 SynthPilot 依赖也由上述固定提交下载入口获取，其上游源码不随本仓库分发。

`fetch-example-upstreams` 下载固定提交的公开 RTL，保留已有 checkout；`plan` 为静态检查；`run` 和 FFT 命令启动真实 EDA，均不创建模型会话。先完成仓库首页的本地安装，并把 `EDA_VIVADO_BIN` 指向 Vivado 2020.2 的 bin 目录。要让 Pi 修复候选，在工作台选择对应 workflow、可修改 RTL 和累计预算后创建验证任务。

`ooc-context.tcl` 是固定的器件级集成夹具：为时钟声明外部 BUFG 位置，为非时钟接口指定可布线范围，配置 bank 电压建模为 3.3 V。该值是本轮测试假设，具体开发板集成须按原理图核对电压、封装和引脚。OOC 通过不代表板卡运行、形式等价或完整 CDC 签核。

Ethernet 的上游 CDC Tcl 通过 `constraint_scripts` 执行；普通 XDC 使用 `constraints`。约束脚本被跳过会阻止验收。`async_reset_ports: ["reset"]` 只声明需要核对的输入：宿主检查每个负载、ASYNC_REG、各时钟的连续复位释放链及 `check_timing` 中的明确例外。原始报告仍保留 `no_input_delay (1)`；普通数据输入和漏约束不会因此通过。

实现步骤保留 `route-in-memory.rpt`，然后保存并重新打开 `routed.dcp` 生成验收报告。Vivado 2020.2 的暂态 `GLOBAL_LOGIC0` 状态与最终交付 DCP 分开记录，最终仍要求所有可布线网络完成、路由错误为零、setup/hold 非负和 DRC 为零。

约束依据：[AMD UG905 Context Constraints](https://docs.amd.com/r/en-US/ug905-vivado-hierarchical-design/Context-Constraints)、[I/O and Clock Buffers](https://docs.amd.com/r/en-US/ug905-vivado-hierarchical-design/I/O-and-Clock-Buffers)。上游 FIFO 约束和许可证保留在 `ethernet-cdc-constraints.tcl`。

历史规格 `a7-*-full*.json` 留作失败和修复过程的协议记录；复跑使用表内的 `a7-final-*`。成绩见 [8 项工程记录](../../docs/a7-eight-projects.md)。
