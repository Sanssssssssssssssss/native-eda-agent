# Recreate the FFT IP in the installed Vivado version. All outputs are run-local.
set_param general.maxThreads 2
set root $::env(EDA_WORKSPACE)
set design [file join $root projects fft-spectrum]
set out [pwd]
create_project spectrum [file join $out prj] -part xc7a100tfgg676-2
set_property target_language Verilog [current_project]
set_property simulator_language Mixed [current_project]
set_property source_mgmt_mode None [current_project]
source [file join $design create-ip.tcl]
generate_target {instantiation_template synthesis simulation} [get_ips xfft_0]
set demo [get_files -all -quiet *tb_xfft_0.vhd]
if {[llength $demo]} { set_property used_in_simulation false $demo }
add_files -norecurse [list [file join $design rtl spectrum_core.v] [file join $root vendor SynthPilot_Tutorial prj 04 rtl magnitude_calc.v]]
set_property top spectrum_core [get_filesets sources_1]
add_files -fileset sim_1 -norecurse [file join $design tb_spectrum.sv]
set_property top tb_spectrum [get_filesets sim_1]
set_property xsim.elaborate.mt_level 2 [get_filesets sim_1]
set_property xsim.simulate.runtime 0ns [get_filesets sim_1]
set simdir [file join $out prj spectrum.sim sim_1 behav xsim]
file mkdir $simdir
file copy [file join $design vectors input.hex] [file join $simdir input.hex]
launch_simulation -simset sim_1 -mode behavioral
log_wave /tb_spectrum/clk /tb_spectrum/rst_n /tb_spectrum/s_data /tb_spectrum/s_valid /tb_spectrum/s_ready /tb_spectrum/s_last
log_wave /tb_spectrum/m_data /tb_spectrum/m_valid /tb_spectrum/m_ready /tb_spectrum/m_last /tb_spectrum/fft_data /tb_spectrum/event_bad_last
log_wave /tb_spectrum/expected_frame /tb_spectrum/frame_bin /tb_spectrum/output_count
run all
close_sim
file copy [file join $simdir spectrum.csv] [file join $out spectrum.csv]
set f [open [file join $simdir simulate.log] r]
set transcript [read $f]
close $f
if {![regexp {SPECTRUM_PROTOCOL_PASS[^\r\n]*} $transcript protocol]} { error "Missing protocol PASS: inspect simulate.log" }
if {[regexp {Fatal:|\[TIMEOUT\]} $transcript]} { error "Simulation failed" }
# Vivado sets PYTHONHOME/PYTHONPATH to its bundled 3.8 libraries. The oracle uses
# the user's installed Python/NumPy, so do not pass those incompatible values.
set saved_python_env [dict create]
foreach key {PYTHONHOME PYTHONPATH} {
    if {[info exists ::env($key)]} { dict set saved_python_env $key $::env($key); unset ::env($key) }
}
set oracle_rc [catch {exec python [file join $design oracle.py] [file join $out spectrum.csv] 2>@1} oracle_text]
dict for {key value} $saved_python_env { set ::env($key) $value }
puts $oracle_text
if {$oracle_rc} { error "Independent oracle failed" }
set f [open [file join $out build-result.json] w]
puts $f [format {{"stage":"simulation","passed":true,"project":"%s","csv":"%s","protocol":"%s","model_api_calls":0}} [file join $out prj spectrum.xpr] [file join $out spectrum.csv] $protocol]
close $f
set f [open [file join $design latest-simulation.txt] w]
puts $f $out
close $f
puts "SPECTRUM_SIM_PASS"
close_project
