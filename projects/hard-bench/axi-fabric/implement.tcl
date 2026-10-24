set root $::env(EDA_WORKSPACE)
set_param general.maxThreads 2
set_param synth.maxThreads 1
read_verilog -sv [file join $root vendor verilog-axi rtl axi_crossbar.v]
read_verilog -sv [file join $root projects hard-bench axi-fabric axi_crossbar_wr_guarded.v]
read_verilog -sv [file join $root vendor verilog-axi rtl axi_crossbar_rd.v]
read_verilog -sv [file join $root projects hard-bench axi-fabric axi_crossbar_addr_guarded.v]
read_verilog -sv [file join $root vendor verilog-axi rtl axi_register_wr.v]
read_verilog -sv [file join $root vendor verilog-axi rtl axi_register_rd.v]
read_verilog -sv [file join $root vendor verilog-axi rtl arbiter.v]
read_verilog -sv [file join $root vendor verilog-axi rtl priority_encoder.v]
read_verilog -sv [file join $root vendor verilog-axi rtl axi_ram.v]
read_verilog -sv [file join $root projects hard-bench axi-fabric rv_delay.sv]
read_verilog -sv [file join $root projects hard-bench axi-fabric axi_error_target.sv]
read_verilog -sv [file join $root projects hard-bench axi-fabric axi_write_completion_guard.sv]
read_verilog -sv [file join $root projects hard-bench axi-fabric axi_fabric_top.sv]
set top axi_fabric_top
source [file join $root projects system-bench implement-common.tcl]
