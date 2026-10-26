# The external asynchronous reset may drive ONLY the three reset synchronizers'
# asynchronous pins. Check every leaf load before constraining this boundary;
# destination clock timing and synchronous reset-release paths stay timed.
set reset_nets [get_nets -segments -of_objects [get_ports reset]]
set reset_loads [get_pins -leaf -of_objects $reset_nets -filter {DIRECTION == IN}]
if {[llength $reset_loads] != 9} {error "Expected 9 asynchronous reset synchronizer pins"}
foreach pin $reset_loads {
    if {![get_property IS_PRESET $pin] && ![get_property IS_RESET $pin]} {error "Unexpected reset load $pin"}
    if {![regexp {^(logic|rx|tx)_reset_sync/} $pin]} {error "Reset escapes synchronizers: $pin"}
}
set_false_path -from [get_ports reset] -to $reset_loads
puts "A7_RESET_BOUNDARY asynchronous_loads=[llength $reset_loads] synchronous_release_preserved=true"
