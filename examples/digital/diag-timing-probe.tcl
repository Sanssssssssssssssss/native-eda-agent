# Diagnostic probe (NOT part of acceptance). Reads the routed checkpoint produced by
# examples/digital/build.tcl and quantifies where the negative setup slack comes from.
# Nothing here is used as evidence of passing; it only locates the bottleneck.
set_param general.maxThreads 2
set root $::env(EDA_WORKSPACE)
open_checkpoint [file join $root artifacts 2026-10-21T16-37-45-196Z-vivado-46f91cf5 counter-routed.dcp]

report_io -file diag-io-before.rpt -force
set base_slack [get_property SLACK [get_timing_paths -delay_type max -max_paths 1]]
set base_path [get_timing_paths -delay_type max -max_paths 1]
set base_src [get_property STARTPOINT_PIN $base_path]
set base_dst [get_property ENDPOINT_PIN $base_path]
set base_delay [get_property DATAPATH_DELAY $base_path]

# Same netlist, only the output buffer slew changed (slow -> fast). Constraints untouched.
set_property SLEW FAST [get_ports count*]
update_timing -full
set fast_path [get_timing_paths -delay_type max -max_paths 1]
set fast_slack [get_property SLACK $fast_path]
set fast_delay [get_property DATAPATH_DELAY $fast_path]

puts "DIAG_BASE_SLACK=$base_slack"
puts "DIAG_BASE_PATH=$base_src -> $base_dst datapath=$base_delay"
puts "DIAG_IOSTANDARD=[get_property IOSTANDARD [get_ports count[0]]]"
puts "DIAG_FAST_SLEW_SLACK=$fast_slack"
puts "DIAG_FAST_SLEW_DATAPATH=$fast_delay"
report_timing -delay_type max -max_paths 1 -path_type summary -file diag-timing-after.rpt
puts "DIAG_DONE"
