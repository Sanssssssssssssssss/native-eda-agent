set root $::env(EDA_WORKSPACE)
set_param general.maxThreads 2
read_verilog -sv [file join $root vendor verilog-axi rtl axi_dma.v]
read_verilog -sv [file join $root vendor verilog-axi rtl axi_dma_rd.v]
read_verilog -sv [file join $root vendor verilog-axi rtl axi_dma_wr.v]
read_verilog -sv [file join $root vendor verilog-ethernet lib axis rtl axis_fifo.v]
read_verilog -sv [file join $root projects system-bench dma dma_top.v]
set top dma_top
source [file join $root projects system-bench implement-common.tcl]
