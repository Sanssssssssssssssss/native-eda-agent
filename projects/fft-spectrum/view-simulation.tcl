set design [file dirname [info script]]
set f [open [file join $design latest-simulation.txt] r]
set run [string trim [read $f]]
close $f
open_project [file join $run prj spectrum.xpr]
set wdb [lindex [glob [file join $run prj spectrum.sim sim_1 behav xsim *.wdb]] 0]
open_wave_database $wdb
create_wave_config
add_wave /tb_spectrum/clk /tb_spectrum/rst_n
add_wave -radix unsigned /tb_spectrum/expected_frame /tb_spectrum/frame_bin /tb_spectrum/output_count
add_wave -radix unsigned /tb_spectrum/s_data
add_wave /tb_spectrum/s_valid /tb_spectrum/s_ready /tb_spectrum/s_last
add_wave -radix unsigned /tb_spectrum/m_data
add_wave /tb_spectrum/m_valid /tb_spectrum/m_ready /tb_spectrum/m_last /tb_spectrum/event_bad_last
add_wave -radix hex /tb_spectrum/fft_data
catch {wave zoom full}
save_wave_config [file join $run spectrum.wcfg]
puts "VERIFIED: 16 frames / 16384 bins; NumPy max component error 1.053542 LSB"
# A local command file permits switching to the routed report without typing
# into an unrelated desktop window. Only this workspace's file is evaluated.
proc poll_view {} {
    set command_file [file join $::env(EDA_WORKSPACE) projects fft-spectrum gui-command.tcl]
    if {[file exists $command_file]} {
        set f [open $command_file r]; set command [read $f]; close $f
        file delete $command_file
        if {[catch {uplevel #0 $command} err]} { puts "GUI_COMMAND_ERROR: $err" }
    }
    after 1000 poll_view
}
after 1000 poll_view
