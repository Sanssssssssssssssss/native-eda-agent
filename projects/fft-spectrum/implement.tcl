set_param general.maxThreads 2
set root $::env(EDA_WORKSPACE)
set design [file join $root projects fft-spectrum]
set out [pwd]
create_project spectrum_impl [file join $out prj] -part xc7a100tfgg676-2
set_property source_mgmt_mode None [current_project]
set_property target_language Verilog [current_project]
source [file join $design create-ip.tcl]
set_property generate_synth_checkpoint false [get_files -all *xfft_0.xci]
generate_target synthesis [get_ips xfft_0]
read_verilog [list [file join $design rtl spectrum_core.v] [file join $root vendor SynthPilot_Tutorial prj 04 rtl magnitude_calc.v]]
synth_design -mode out_of_context -top spectrum_core -part xc7a100tfgg676-2
if {[llength [get_cells -hier -quiet -filter {IS_BLACKBOX == 1}]] != 0} { error "Unresolved black boxes in netlist" }
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
write_checkpoint -force spectrum-routed.dcp
write_xdc -force applied-constraints.xdc
set setup [get_timing_paths -delay_type max -max_paths 1]
set hold [get_timing_paths -delay_type min -max_paths 1]
if {![llength $setup] || ![llength $hold]} { error "Missing constrained timing paths" }
set wns [get_property SLACK $setup]
set whs [get_property SLACK $hold]
set ffs [llength [get_cells -hier -filter {REF_NAME =~ FD*}]]
set luts [llength [get_cells -hier -filter {REF_NAME =~ LUT*}]]
set dsps [llength [get_cells -hier -filter {REF_NAME =~ DSP48*}]]
set r18 [llength [get_cells -hier -filter {REF_NAME =~ RAMB18*}]]
set r36 [llength [get_cells -hier -filter {REF_NAME =~ RAMB36*}]]
set f [open build-result.json w]
puts $f [format {{"stage":"routed","version":"%s","part":"xc7a100tfgg676-2","clock_period_ns":10.0,"io_delay_ns":2.0,"setup_slack_ns":%s,"hold_slack_ns":%s,"flip_flops":%d,"lut_cells":%d,"dsp48":%d,"ramb18":%d,"ramb36":%d,"implementation_mode":"out_of_context","black_boxes":0,"board_io_validated":false,"bitstream_generated":false,"hardware_tested":false,"model_api_calls":0}} [version -short] $wns $whs $ffs $luts $dsps $r18 $r36]
close $f
if {$wns < 0 || $whs < 0} { error "Routed timing failed; preserved DCP and reports" }
set f [open [file join $design latest-implementation.txt] w]
puts $f $out
close $f
puts "SPECTRUM_IMPLEMENTATION_PASS"
close_project
