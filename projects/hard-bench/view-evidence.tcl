set design [file dirname [info script]]
set root [file normalize [file join $design ../..]]
set evidence [file join $root artifacts hard-bench-assessment-20261023]
open_checkpoint [file join $root artifacts hard-ethernet-cdc-impl-20261022T184242Z-8aa581 ethernet_cdc_top-routed.dcp]
set f [open [file join $evidence reset-cell-properties.txt] w]
foreach cell [get_cells -hier -regexp {.*reset_sync/sync_reg_reg.*}] {
    puts $f "$cell|[get_property REF_NAME $cell]|[get_property ASYNC_REG $cell]"
}
close $f
report_utilization -name Ethernet_resources
report_timing_summary -name Ethernet_100_125_125_MHz -max_paths 10
proc poll_hard_view {} {
    set command_file [file join $::design gui-command.tcl]
    if {[file exists $command_file]} {
        set f [open $command_file r];set command [read $f];close $f
        file delete $command_file
        if {[catch {uplevel #0 $command} err]} {puts "GUI_COMMAND_ERROR: $err"}
    }
    after 1000 poll_hard_view
}
after 1000 poll_hard_view
puts "HARD_BENCH_VIEW_READY"
