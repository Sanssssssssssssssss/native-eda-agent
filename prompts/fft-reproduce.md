实现一个中等规模 Vivado FFT 工程复刻，严格只改 projects/fft-spectrum 下新建的实现与 Tcl 文件；禁止修改 oracle.py、tb_spectrum.sv、vectors、vendor、src 和约束验收阈值。

来源：vendor/SynthPilot_Tutorial/prj/04 的 1024 点 FFT 音乐频谱工程，commit c415ec77d296b38c2bb384141eb9952f1eb84344。原项目 KU3P + Vivado 2024.2；这次复刻信号处理核到 xc7a100tfgg676-2 / Vivado 2020.2，原版 Pi，真实工具执行。无需 PCIe、上位机、bitstream。

需要实现 spectrum_core.v，端口与固定 tb_spectrum.sv 匹配：clk,rst_n；16位 s_data, s_valid,s_last,s_ready；16位 m_data,m_valid,m_last,m_ready；32位 fft_data 调试输出（与 m_data 同拍 FFT 复数）；event_bad_last 是FFT missing/unexpected TLAST事件的OR。底层必须是真正的 Xilinx xfft 9.1 IP，1024点，pipelined_streaming_io，16bit input/phase，scaled，convergent_rounding，natural_order，nonrealtime，aresetn=true。配置字 16'h0557，总缩放2048。复位后先发送配置并给足生效时间，再允许输入。复位后的第一帧必须正确，不允许丢弃预热帧。m_data 使用原仓库 magnitude_calc.v 的 L1 |Re|+|Im| 近似，饱和16位。可直接引用原文件（当普通Verilog读入）。

先读固定 testbench 和 oracle，以及原IP的XCI/RTL了解接口。创建 simulate.tcl：set_param general.maxThreads 2；使用 EDA_WORKSPACE 找输入，输出在工具运行cwd；创建持久项目；create_ip并配置/generate_target；添加 source、原 magnitude_calc 和固定SV testbench。把 vectors/input.hex 复制到 XSim工作目录（或 sim fileset memory file）；launch_simulation -simset sim_1 -mode behavioral；log_wave 关键顶层信号；run all；保留WDB、CSV、sim日志；close_sim。运行独立 python oracle.py <实际CSV路径>，失败即error。保存 build-result.json 提供项目路径、CSV路径、oracle结果位置，不凭空填写PASS。必须 eda_vivado 调用 simulate.tcl；若失败可以修实现/Tcl后重试，但固定oracle与TB不可变。

通过仿真后创建 implement.tcl，引用最新成功仿真项目的IP和RTL；synth_design -mode out_of_context -top spectrum_core -part xc7a100tfgg676-2；100MHz create_clock，所有非时钟输入set_input_delay 2.0，所有输出set_output_delay 2.0，约束复位input同样保留不false path。不放宽时钟。opt/place/route，check_timing，report_utilization，report_timing_summary，report_route_status，report_drc，write_checkpoint。保存 build-result.json 含版本、器件、setup/hold slack、LUT/FF/DSP/BRAM、board_io_validated false等。不得把黑盒IP或未约束端点当成功。若仿真/实现耗时多，先完成仿真并明确报告剩余工作。

不要读取凭据。不要安装任何东西。不要调用计数器专用eda_verify。独立 oracle 使用NumPy FFT每帧1024点/2048，16帧全量逐点比较。可以使用powershell整理路径和读取日志，EDA只用 eda_vivado。最终中文简要报告真实证据路径、已通过/未通过和修改。
