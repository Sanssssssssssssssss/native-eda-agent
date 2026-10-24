puts "PROBE_VIVADO=[version -short]"
foreach cmd {launch_simulation synth_ip read_ip create_ip generate_target} {
    if {[catch {help $cmd} e]} {
        puts "PROBE_HELP_$cmd ERROR: $e"
    } else {
        puts "PROBE_HELP_$cmd:\n$e"
    }
}
if {[catch {get_ipdefs -filter {NAME =~ *xfft*}} e]} {
    puts "PROBE_IPDEF ERROR: $e"
} else {
    puts "PROBE_IPDEF: $e"
}
puts "PROBE_DONE"
