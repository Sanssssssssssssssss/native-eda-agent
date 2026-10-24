set root $::env(EDA_WORKSPACE)
set_param general.maxThreads 2
read_verilog -sv [file join $root vendor picorv32 picorv32.v]
read_verilog -sv [file join $root projects system-bench soc soc_top.v]
set top soc_top
source [file join $root projects system-bench implement-common.tcl]
