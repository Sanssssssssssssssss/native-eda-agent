# Physical target clocks. The two GMII clocks originate independently.
create_clock -name logic_clk -period 10.0 [get_ports logic_clk]
create_clock -name rx_clk -period 8.0 [get_ports rx_clk]
create_clock -name tx_clk -period 8.0 -waveform {1.3 5.3} [get_ports tx_clk]
set_input_delay -clock logic_clk 2.0 [get_ports app_pause]
set_input_delay -clock rx_clk 2.0 [get_ports {gmii_rxd[*] gmii_rx_dv gmii_rx_er}]
set_output_delay -clock tx_clk 2.0 [get_ports {gmii_txd[*] gmii_tx_en gmii_tx_er tx_rst}]
set_output_delay -clock rx_clk 2.0 [get_ports rx_rst]
set_output_delay -clock logic_clk 2.0 [get_ports {logic_rst rx_bad_frame rx_bad_fcs rx_overflow tx_underflow guard_rejected ip_bad_checksum app_received[*] app_echoed[*]}]
# No blanket clock_groups/false_path: preserve the upstream Gray pointer
# max_delay and bus_skew checks, and time all synchronizer destination stages.
source [file join $root vendor verilog-ethernet lib axis syn vivado axis_async_fifo.tcl]
source [file join $root vendor verilog-ethernet lib axis syn vivado sync_reset.tcl]
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
