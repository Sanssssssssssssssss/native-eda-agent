set root $::env(EDA_WORKSPACE)
set_param general.maxThreads 2
set_param synth.maxThreads 1
foreach relative {scripts/rt/fpga_tcl/rtSynthParallelPrep.tcl scripts/rt/data/unimacro/unimacro_vhdl.tcl scripts/rt/data/unimacro/unimacro_verilog.tcl} {
  set dependency [file join $::env(XILINX_VIVADO) $relative]
  set handle [open $dependency r]
  set bytes [string length [read $handle]]
  close $handle
  puts "AES_TOOL_PREFLIGHT path=$dependency bytes=$bytes"
}
read_verilog -sv [file join $root vendor aes src rtl aes_core.v]
read_verilog -sv [file join $root vendor aes src rtl aes_encipher_block.v]
read_verilog -sv [file join $root vendor aes src rtl aes_decipher_block.v]
read_verilog -sv [file join $root vendor aes src rtl aes_key_mem.v]
read_verilog -sv [file join $root vendor aes src rtl aes_sbox.v]
read_verilog -sv [file join $root vendor aes src rtl aes_inv_sbox.v]
read_verilog -sv [file join $root projects system-bench aes aes_stream_top.sv]
set top aes_stream_top
source [file join $root projects system-bench implement-common.tcl]
