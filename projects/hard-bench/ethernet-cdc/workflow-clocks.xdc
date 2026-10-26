# Physical target clocks. The two GMII clocks originate independently.
create_clock -name logic_clk -period 10.0 [get_ports logic_clk]
create_clock -name rx_clk -period 8.0 [get_ports rx_clk]
create_clock -name tx_clk -period 8.0 -waveform {1.3 5.3} [get_ports tx_clk]
set_input_delay -clock logic_clk 2.0 [get_ports app_pause]
set_input_delay -clock rx_clk 2.0 [get_ports {gmii_rxd[*] gmii_rx_dv gmii_rx_er}]
set_output_delay -clock tx_clk 2.0 [get_ports {gmii_txd[*] gmii_tx_en gmii_tx_er tx_rst}]
set_output_delay -clock rx_clk 2.0 [get_ports rx_rst]
set_output_delay -clock logic_clk 2.0 [get_ports {logic_rst rx_bad_frame rx_bad_fcs rx_overflow tx_underflow guard_rejected ip_bad_checksum app_received[*] app_echoed[*]}]
