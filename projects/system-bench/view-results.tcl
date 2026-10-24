set design [file dirname [info script]]
set root [file normalize [file join $design ../..]]
open_checkpoint [file join $root artifacts 2026-10-22T17-59-58-182Z-vivado-477913d5 soc_top-routed.dcp]
report_utilization -name soc_resources
report_timing_summary -name soc_100MHz_timing -max_paths 10
# Only this workspace command file controls the dedicated evidence window.
proc poll_system_view {} {
    set command_file [file join $::design gui-command.tcl]
    if {[file exists $command_file]} {
        set f [open $command_file r];set command [read $f];close $f
        file delete $command_file
        if {[catch {uplevel #0 $command} err]} {puts "GUI_COMMAND_ERROR: $err"}
    }
    after 1000 poll_system_view
}
after 1000 poll_system_view
puts "SYSTEM_BENCH_VIEW_READY"
