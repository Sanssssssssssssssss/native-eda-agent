synth_design -mode out_of_context -top $top -part xc7a100tfgg676-2
if {[llength [get_cells -hier -quiet -filter {IS_BLACKBOX == 1}]]} {error "Unresolved black boxes"}
create_clock -name clk -period 10.0 [get_ports clk]
set_input_delay -clock clk 2.0 [get_ports -filter {DIRECTION == IN && NAME != clk}]
set_output_delay -clock clk 2.0 [get_ports -filter {DIRECTION == OUT}]
opt_design
place_design
route_design
report_utilization -file utilization.rpt
report_utilization -hierarchical -file utilization-hierarchical.rpt
report_timing_summary -report_unconstrained -file timing-summary.rpt
check_timing -verbose -file check-timing.rpt
report_route_status -file route-status.rpt
report_drc -file drc.rpt
write_checkpoint -force ${top}-routed.dcp
write_xdc -force applied-constraints.xdc
set setup [get_timing_paths -delay_type max -max_paths 1]
set hold [get_timing_paths -delay_type min -max_paths 1]
if {![llength $setup] || ![llength $hold]} {error "Missing timing paths"}
set wns [get_property SLACK $setup]
set whs [get_property SLACK $hold]
set f [open build-result.json w]
puts $f [format { {"stage":"routed","top":"%s","version":"%s","part":"xc7a100tfgg676-2","clock_period_ns":10.0,"io_delay_ns":2.0,"setup_slack_ns":%s,"hold_slack_ns":%s,"flip_flops":%d,"lut_cells":%d,"dsp48":%d,"ramb18":%d,"ramb36":%d,"implementation_mode":"out_of_context","black_boxes":0,"board_io_validated":false,"hardware_tested":false,"model_api_calls":0} } $top [version -short] $wns $whs [llength [get_cells -hier -filter {REF_NAME =~ FD*}]] [llength [get_cells -hier -filter {REF_NAME =~ LUT*}]] [llength [get_cells -hier -filter {REF_NAME =~ DSP48*}]] [llength [get_cells -hier -filter {REF_NAME =~ RAMB18*}]] [llength [get_cells -hier -filter {REF_NAME =~ RAMB36*}]]]
close $f
# Timing failure is retained in JSON and must not become a pass via process exit.
if {$wns<0 || $whs<0} {error "Routed timing failed"}
puts "SYSTEM_IMPLEMENTATION_PASS $top"
