请直接完成这套 EDA 环境的实际验证，不要只给计划或询问是否继续。

1. 用 eda_xsim 运行 examples/digital/counter.v 与 examples/digital/tb_counter.sv，顶层 tb_counter。读取输出，要求 COUNTER_PASS checks=321 wraps=1 holds=7 resets=3。
2. 用 eda_vivado 运行 examples/digital/build.tcl，完成综合、布局、布线。读取返回目录中的 build-result.json 与 timing-summary.rpt，报告真实 setup / hold slack、LUT 和寄存器数量。
3. 必须通过官方 LTspice MCP 实际执行一次仿真。先用 codemode 查看相关工具 schema，打开 examples/analog/rc_lowpass.cir，启动仿真，等待完成，读取 SPICE 日志和数字波形数据。该文件有 AC 和 transient 两种分析，若工具需要选择分析，分别执行。把原始工具返回保存至 artifacts/，不要把推算值冒充实测值。若官方桥接确实失败，记录原始错误，再使用 eda_ltspice_batch 完成数值检查，并明确区别。
4. 用 scripts/verify-results.py 检查刚才的 XSim、Vivado 和模拟仿真日志，输出 artifacts/acceptance.json。理论截止频率是 1/(2*pi*1000*100e-9)。如原始 LTspice 日志分成两份，可复制并拼接原始文本供检查，保留源文件路径。
5. 在 artifacts/pi-validation-summary.md 写短报告：工具与模型、实际运行结果、对应文件、未完成项。不要声称生成 bitstream 或已上板。本轮没有这两项。

只使用当前 EDAAgent 目录中的文件。固定测试、约束和校验脚本不能修改。允许修复设计或新增辅助文件，但失败时必须保存原始错误，并解释修改。不安装额外软件，不读取任何凭据文件。完成后用中文报告。
