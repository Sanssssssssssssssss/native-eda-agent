set root $::env(EDA_WORKSPACE)
set_param general.maxThreads 2
set_param synth.maxThreads 1
set prep [file join $::env(XILINX_VIVADO) scripts rt fpga_tcl rtSynthParallelPrep.tcl]
puts "UDP_SYNTH_PREFLIGHT path=$prep exists=[file exists $prep] readable=[file readable $prep]"
read_verilog -sv [file join $root vendor verilog-ethernet rtl udp_complete.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl udp.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl udp_checksum_gen.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl udp_ip_rx.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl udp_ip_tx.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl ip_complete.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl ip.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl ip_eth_rx.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl ip_eth_tx.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl ip_arb_mux.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl arp.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl arp_cache.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl arp_eth_rx.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl arp_eth_tx.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl eth_arb_mux.v]
read_verilog -sv [file join $root vendor verilog-ethernet rtl lfsr.v]
read_verilog -sv [file join $root vendor verilog-ethernet lib axis rtl arbiter.v]
read_verilog -sv [file join $root vendor verilog-ethernet lib axis rtl priority_encoder.v]
read_verilog -sv [file join $root vendor verilog-ethernet lib axis rtl axis_fifo.v]
read_verilog -sv [file join $root projects system-bench udp udp_top.v]
set top udp_top
source [file join $root projects system-bench implement-common.tcl]
