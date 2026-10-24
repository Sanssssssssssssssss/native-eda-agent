set root $::env(EDA_WORKSPACE)
set_param general.maxThreads 2
set_param synth.maxThreads 1
source [file join $root projects hard-bench ethernet-cdc read-sources.tcl]
synth_design -mode out_of_context -top ethernet_cdc_top -part xc7a100tfgg676-2
if {[llength [get_cells -hier -quiet -filter {IS_BLACKBOX == 1}]]} {error "Unresolved black boxes"}
source [file join $root projects hard-bench ethernet-cdc constraints.tcl]
check_timing -verbose -file check-timing-synth.rpt
report_cdc -details -file cdc-synth.rpt
report_exceptions -ignored -file ignored-exceptions-synth.rpt
report_exceptions -coverage -file exception-coverage-synth.rpt
opt_design
place_design
route_design
report_utilization -file utilization.rpt
report_utilization -hierarchical -file utilization-hierarchical.rpt
report_timing_summary -report_unconstrained -file timing-summary.rpt
check_timing -verbose -file check-timing.rpt
report_cdc -details -file cdc.rpt
report_bus_skew -file bus-skew.rpt
report_exceptions -ignored -file ignored-exceptions.rpt
report_exceptions -coverage -file exception-coverage.rpt
report_clock_interaction -file clock-interaction.rpt
report_route_status -file route-status.rpt
report_drc -file drc.rpt
write_checkpoint -force ethernet_cdc_top-routed.dcp
write_xdc -force applied-constraints.xdc
set setup [get_timing_paths -delay_type max -max_paths 1]
set hold [get_timing_paths -delay_type min -max_paths 1]
if {![llength $setup] || ![llength $hold]} {error "Missing timing paths"}
set wns [get_property SLACK $setup]
set whs [get_property SLACK $hold]
set f [open build-result.json w]
puts $f [format { {"stage":"routed","top":"ethernet_cdc_top","part":"xc7a100tfgg676-2","logic_period_ns":10.0,"rx_period_ns":8.0,"tx_period_ns":8.0,"setup_slack_ns":%s,"hold_slack_ns":%s,"implementation_mode":"out_of_context","cdc_review_required":true,"board_io_validated":false,"hardware_tested":false,"other_model_API_calls":0} } $wns $whs]
close $f
if {$wns<0 || $whs<0} {error "Routed timing failed"}
puts "HARD_BENCH_IMPLEMENTATION_ROUTED ethernet-cdc CDC_REVIEW_REQUIRED"
