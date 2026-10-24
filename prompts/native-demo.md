运行一次完整 EDA 验证，直接执行并报告结果。使用原生工具 eda_xsim、eda_vivado、eda_ltspice_batch、eda_verify；无需探索 GUI 或调用系统窗口 API。

顺序：
1. eda_xsim：sources 为 examples/digital/counter.v 与 examples/digital/tb_counter.sv；top 为 tb_counter。
2. eda_vivado：script 为 examples/digital/build-core.tcl。这是 out_of_context 核内布局布线，不能声称板级 IO 时序通过；原 build.tcl 的自动 IO 分配时序失败记录仍然有效。
3. eda_ltspice_batch 分别运行 examples/analog/rc_ac.cir 和 examples/analog/rc_tran.cir。
4. 将两个工具返回的原始 measurements_and_log 文本合并到 artifacts/native-demo-analog.log，附上两个源日志路径。
5. eda_verify：传入本轮 XSim/Vivado 返回的 directory 和刚才合并日志的路径。
6. 报告实际的检查结果、setup/hold slack、截止频率、阶跃响应，链接本轮产物。最后明确未生成 bitstream、未上板。

保留所有固定测试和约束。本轮遇到失败直接记录失败并停止，不重试、不改实现、不调用与此流程无关的工具。
