# Boardless RTL-core implementation. This does not validate package/PCB I/O timing.
set_param general.maxThreads 2
set root $::env(EDA_WORKSPACE)
set part xc7a100tfgg676-2
read_verilog [file join $root examples digital counter.v]
synth_design -mode out_of_context -top counter -part $part
create_clock -name clk -period 10.000 [get_ports clk]
set_input_delay -clock clk 2.000 [get_ports {rst en}]
set_output_delay -clock clk 2.000 [get_ports count*]
opt_design
place_design
route_design
report_utilization -file utilization.rpt
report_timing_summary -report_unconstrained -file timing-summary.rpt
check_timing -verbose -file check-timing.rpt
write_checkpoint -force counter-routed.dcp
write_xdc -force applied-constraints.xdc
set setup_path [get_timing_paths -delay_type max -max_paths 1]
set hold_path [get_timing_paths -delay_type min -max_paths 1]
if {[llength $setup_path] == 0 || [llength $hold_path] == 0} { error "Missing timing paths" }
set setup_slack [get_property SLACK $setup_path]
set hold_slack [get_property SLACK $hold_path]
set ffs [llength [get_cells -hier -filter {REF_NAME =~ FD*}]]
set luts [llength [get_cells -hier -filter {REF_NAME =~ LUT*}]]
set output [open build-result.json w]
puts $output [format {{"tool":"Vivado","version":"%s","part":"%s","clock_period_ns":10.0,"setup_slack_ns":%s,"hold_slack_ns":%s,"flip_flops":%d,"lut_cells":%d,"stage":"routed","implementation_mode":"out_of_context","board_io_validated":false,"bitstream_generated":false,"hardware_tested":false}} [version -short] $part $setup_slack $hold_slack $ffs $luts]
close $output
if {$setup_slack < 0 || $hold_slack < 0} { error "Core timing failed; inspect timing-summary.rpt" }
puts "EDA_CORE_BUILD_PASS"
