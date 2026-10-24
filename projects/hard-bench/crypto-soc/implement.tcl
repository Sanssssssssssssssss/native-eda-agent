set root $::env(EDA_WORKSPACE)
set_param general.maxThreads 2
set_param synth.maxThreads 1
read_verilog -sv [file join $root vendor picorv32 picorv32.v]
read_verilog -sv [file join $root vendor aes src rtl aes_core.v]
read_verilog -sv [file join $root vendor aes src rtl aes_encipher_block.v]
read_verilog -sv [file join $root vendor aes src rtl aes_decipher_block.v]
read_verilog -sv [file join $root vendor aes src rtl aes_key_mem.v]
read_verilog -sv [file join $root vendor aes src rtl aes_sbox.v]
read_verilog -sv [file join $root vendor aes src rtl aes_inv_sbox.v]
read_verilog -sv [file join $root projects hard-bench crypto-soc shared_ram.sv]
read_verilog -sv [file join $root projects hard-bench crypto-soc ctr_dma.sv]
read_verilog -sv [file join $root projects hard-bench crypto-soc crypto_soc_top.sv]
set top crypto_soc_top
source [file join $root projects system-bench implement-common.tcl]
