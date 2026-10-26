# No blanket clock_groups/false_path: preserve the upstream Gray pointer
# max_delay and bus_skew checks, and time all synchronizer destination stages.
# Copyright (c) 2019-2023 Alex Forencich
# 
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# 
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
# 
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.

# AXI stream asynchronous FIFO timing constraints

foreach fifo_inst [get_cells -hier -filter {(ORIG_REF_NAME == axis_async_fifo || REF_NAME == axis_async_fifo)}] {
    puts "Inserting timing constraints for axis_async_fifo instance $fifo_inst"

    # get clock periods
    set write_clk [get_clocks -of_objects [get_cells -quiet "$fifo_inst/wr_ptr_reg_reg[*] $fifo_inst/wr_ptr_gray_reg_reg[*] $fifo_inst/rd_ptr_gray_sync1_reg_reg[*]"]]
    set read_clk [get_clocks -of_objects [get_cells -quiet "$fifo_inst/rd_ptr_reg_reg[*] $fifo_inst/rd_ptr_gray_reg_reg[*] $fifo_inst/wr_ptr_gray_sync1_reg_reg[*]"]]

    set write_clk_period [if {[llength $write_clk]} {get_property -min PERIOD $write_clk} {expr 1.0}]
    set read_clk_period [if {[llength $read_clk]} {get_property -min PERIOD $read_clk} {expr 1.0}]

    set min_clk_period [expr min($write_clk_period, $read_clk_period)]

    # reset synchronization
    set reset_ffs [get_cells -quiet -hier -regexp ".*/s_rst_sync\[23\]_reg_reg" -filter "PARENT == $fifo_inst"]

    if {[llength $reset_ffs]} {
        set_property ASYNC_REG TRUE $reset_ffs

        # hunt down source
        set dest [get_cells $fifo_inst/s_rst_sync2_reg_reg]
        set dest_pins [get_pins -of_objects $dest -filter {REF_PIN_NAME == D}]
        set net [get_nets -segments -of_objects $dest_pins]
        set source_pins [get_pins -of_objects $net -filter {IS_LEAF && DIRECTION == OUT}]
        set source [get_cells -of_objects $source_pins]

        set_max_delay -from $source -to $dest -datapath_only $read_clk_period
    }

    set reset_ffs [get_cells -quiet -hier -regexp ".*/m_rst_sync\[23\]_reg_reg" -filter "PARENT == $fifo_inst"]

    if {[llength $reset_ffs]} {
        set_property ASYNC_REG TRUE $reset_ffs

        # hunt down source
        set dest [get_cells $fifo_inst/m_rst_sync2_reg_reg]
        set dest_pins [get_pins -of_objects $dest -filter {REF_PIN_NAME == D}]
        set net [get_nets -segments -of_objects $dest_pins]
        set source_pins [get_pins -of_objects $net -filter {IS_LEAF && DIRECTION == OUT}]
        set source [get_cells -of_objects $source_pins]

        set_max_delay -from $source -to $dest -datapath_only $write_clk_period
    }

    # pointer synchronization
    set sync_ffs [get_cells -quiet -hier -regexp ".*/rd_ptr_gray_sync\[12\]_reg_reg\\\[\\d+\\\]" -filter "PARENT == $fifo_inst"]

    if {[llength $sync_ffs]} {
        set_property ASYNC_REG TRUE $sync_ffs

        set_max_delay -from [get_cells "$fifo_inst/rd_ptr_reg_reg[*] $fifo_inst/rd_ptr_gray_reg_reg[*]"] -to [get_cells "$fifo_inst/rd_ptr_gray_sync1_reg_reg[*]"] -datapath_only $read_clk_period
        set_bus_skew  -from [get_cells "$fifo_inst/rd_ptr_reg_reg[*] $fifo_inst/rd_ptr_gray_reg_reg[*]"] -to [get_cells "$fifo_inst/rd_ptr_gray_sync1_reg_reg[*]"] $write_clk_period
    }

    set sync_ffs [get_cells -quiet -hier -regexp ".*/wr_ptr_gray_sync\[12\]_reg_reg\\\[\\d+\\\]" -filter "PARENT == $fifo_inst"]

    if {[llength $sync_ffs]} {
        set_property ASYNC_REG TRUE $sync_ffs

        set_max_delay -from [get_cells -quiet "$fifo_inst/wr_ptr_reg_reg[*] $fifo_inst/wr_ptr_gray_reg_reg[*]"] -to [get_cells "$fifo_inst/wr_ptr_gray_sync1_reg_reg[*]"] -datapath_only $write_clk_period
        set_bus_skew  -from [get_cells -quiet "$fifo_inst/wr_ptr_reg_reg[*] $fifo_inst/wr_ptr_gray_reg_reg[*]"] -to [get_cells "$fifo_inst/wr_ptr_gray_sync1_reg_reg[*]"] $read_clk_period
    }

    set sync_ffs [get_cells -quiet -hier -regexp ".*/wr_ptr_commit_sync_reg_reg\\\[\\d+\\\]" -filter "PARENT == $fifo_inst"]

    if {[llength $sync_ffs]} {
        set_property ASYNC_REG TRUE $sync_ffs

        set_max_delay -from [get_cells -quiet "$fifo_inst/wr_ptr_sync_commit_reg_reg[*]"] -to [get_cells "$fifo_inst/wr_ptr_commit_sync_reg_reg[*]"] -datapath_only $write_clk_period
        set_bus_skew  -from [get_cells -quiet "$fifo_inst/wr_ptr_sync_commit_reg_reg[*]"] -to [get_cells "$fifo_inst/wr_ptr_commit_sync_reg_reg[*]"] $read_clk_period
    }

    # output register (needed for distributed RAM sync write/async read)
    set output_reg_ffs [get_cells -quiet "$fifo_inst/m_axis_pipe_reg_reg[0][*]"]

    if {[llength $output_reg_ffs]} {
        if {[llength $write_clk]} {
            set_false_path -from $write_clk -to $output_reg_ffs
        }
    }

    # frame FIFO pointer update synchronization
    set update_ffs [get_cells -quiet -hier -regexp ".*/wr_ptr_update(_ack)?_sync\[123\]_reg_reg" -filter "PARENT == $fifo_inst"]

    if {[llength $update_ffs]} {
        set_property ASYNC_REG TRUE $update_ffs

        set_max_delay -from [get_cells "$fifo_inst/wr_ptr_update_reg_reg"] -to [get_cells "$fifo_inst/wr_ptr_update_sync1_reg_reg"] -datapath_only $write_clk_period
        set_max_delay -from [get_cells "$fifo_inst/wr_ptr_update_sync3_reg_reg"] -to [get_cells "$fifo_inst/wr_ptr_update_ack_sync1_reg_reg"] -datapath_only $read_clk_period
    }

    # status synchronization
    foreach i {overflow bad_frame good_frame} {
        set status_sync_regs [get_cells -quiet -hier -regexp ".*/${i}_sync\[123\]_reg_reg" -filter "PARENT == $fifo_inst"]

        if {[llength $status_sync_regs]} {
            set_property ASYNC_REG TRUE $status_sync_regs

            set_max_delay -from [get_cells "$fifo_inst/${i}_sync1_reg_reg"] -to [get_cells "$fifo_inst/${i}_sync2_reg_reg"] -datapath_only $read_clk_period
        }
    }

    # pause sync
    set sync_ffs [get_cells -quiet -hier -regexp ".*/pause.s_pause_req_sync\[123\]_reg_reg" -filter "PARENT == $fifo_inst"]

    if {[llength $sync_ffs]} {
        set_property ASYNC_REG TRUE $sync_ffs

        set_max_delay -from [get_cells "$fifo_inst/pause.s_pause_req_sync1_reg_reg"] -to [get_cells "$fifo_inst/pause.s_pause_req_sync2_reg_reg"] -datapath_only $read_clk_period
    }

    set sync_ffs [get_cells -quiet -hier -regexp ".*/pause.s_pause_ack_sync\[123\]_reg_reg" -filter "PARENT == $fifo_inst"]

    if {[llength $sync_ffs]} {
        set_property ASYNC_REG TRUE $sync_ffs

        set_max_delay -from [get_cells "$fifo_inst/pause.s_pause_ack_sync1_reg_reg"] -to [get_cells "$fifo_inst/pause.s_pause_ack_sync2_reg_reg"] -datapath_only $write_clk_period
    }
}

# Copyright (c) 2020 Alex Forencich
# 
# Permission is hereby granted, free of charge, to any person obtaining a copy
# of this software and associated documentation files (the "Software"), to deal
# in the Software without restriction, including without limitation the rights
# to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
# copies of the Software, and to permit persons to whom the Software is
# furnished to do so, subject to the following conditions:
# 
# The above copyright notice and this permission notice shall be included in
# all copies or substantial portions of the Software.
# 
# THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
# IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY
# FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
# AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
# LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
# OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
# THE SOFTWARE.

# reset synchronizer timing constraints

foreach inst [get_cells -hier -filter {(ORIG_REF_NAME == sync_reset || REF_NAME == sync_reset)}] {
    puts "Inserting timing constraints for sync_reset instance $inst"

    # reset synchronization
    set reset_ffs [get_cells -quiet -hier -regexp ".*/sync_reg_reg\\\[\\d+\\\]" -filter "PARENT == $inst"]

    set_property ASYNC_REG TRUE $reset_ffs
    set_false_path -to [get_pins -of_objects $reset_ffs -filter {IS_PRESET || IS_RESET}]
}

set fifos [get_cells -hier -filter {ORIG_REF_NAME == axis_async_fifo || REF_NAME == axis_async_fifo}]
if {[llength $fifos]!=2} {error "Expected exactly two MAC asynchronous FIFOs"}
# The upstream eth_mac_fifo.tcl name matcher excludes bare eth_mac_1g_fifo.
# Its status crossings use source toggles and destination 2/3 synchronizers.
foreach pair {{rx 8.0} {tx 8.0}} {
 lassign $pair domain period
 set syncs [get_cells -hier -regexp [format {^mac/%s_sync_reg_[23]_reg.*$} $domain]]
 set src [get_cells -hier -regexp [format {^mac/%s_sync_reg_1_reg.*$} $domain]]
 set dst [get_cells -hier -regexp [format {^mac/%s_sync_reg_2_reg.*$} $domain]]
 if {![llength $syncs] || ![llength $src] || ![llength $dst]} {error "MAC $domain status synchronizer missing"}
 set_property ASYNC_REG TRUE $syncs
 set_max_delay -datapath_only $period -from $src -to $dst
}
# reset is asynchronous only into each reset synchronizer. The upstream reset
# script exempts those asynchronous reset pins; release follows 3 local edges.

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
