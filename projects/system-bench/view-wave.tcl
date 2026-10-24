set design [file dirname [info script]]
set root [file normalize [file join $design ../..]]
create_project -in_memory -part xc7a100tfgg676-2
open_wave_database [file join $root artifacts 2026-10-22T18-10-31-512Z-xsim-eb357a36 eda_snapshot.wdb]
open_wave_config [file join $root artifacts system-bench-assessment-20261023 udp-detail.wcfg]
puts "WAVE_GUI_COMMANDS [info commands *gui*window*]"
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
puts "UDP_DETAIL_VIEW_READY"
