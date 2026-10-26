# Reproducible device-level integration fixture, not a development-board pinout.
# A7-100T FGG676-2; external global clock buffers; device interface range.
# Configuration-bank voltage is a declared 3.3 V fixture assumption. A board
# integration MUST replace/confirm it against its schematic before bitstream use.
if {[get_property PART [current_design]] ne "xc7a100tfgg676-2"} {error "A7 fixture part mismatch"}
set_property CFGBVS VCCO [current_design]
set_property CONFIG_VOLTAGE 3.3 [current_design]
set clock_ports {}
set clock_index 0
foreach port [lsort [get_ports -filter {DIRECTION == IN}]] {
    if {[llength [get_clocks -quiet -of_objects $port]]} {
        set site BUFGCTRL_X0Y${clock_index}
        if {[llength [get_sites -quiet $site]] != 1} {error "Missing A7 clock buffer $site"}
        set_property HD.CLK_SRC $site $port
        lappend clock_ports $port
        incr clock_index
    }
}
if {![llength $clock_ports]} {error "A7 fixture requires declared clocks"}
set min_x 100000; set min_y 100000; set max_x 0; set max_y 0
foreach site [get_sites -quiet SLICE_X*Y*] {
    if {[regexp {^SLICE_X([0-9]+)Y([0-9]+)$} $site unused x y]} {
        set min_x [expr {min($min_x,$x)}]; set max_x [expr {max($max_x,$x)}]
        set min_y [expr {min($min_y,$y)}]; set max_y [expr {max($max_y,$y)}]
    }
}
# A7 has an irregular outline: the largest X and largest Y need not intersect.
# Choose a real upper-edge site rather than inventing a rectangular corner.
set max_x 0
foreach site [get_sites -quiet SLICE_X*Y${max_y}] {
    if {[regexp {^SLICE_X([0-9]+)Y([0-9]+)$} $site unused x y]} {set max_x [expr {max($max_x,$x)}]}
}
if {$min_x > $max_x} {error "A7 fixture has no slice sites"}
set interface_range SLICE_X${min_x}Y${min_y}:SLICE_X${max_x}Y${max_y}
foreach port [get_ports] {
    if {[lsearch -exact $clock_ports $port] < 0} {
        set_property HD.PARTPIN_RANGE $interface_range $port
    }
}
puts "A7_OOC_CONTEXT clocks=$clock_ports interface_range=$interface_range config_voltage=3.3 board_pinout_validated=false"
