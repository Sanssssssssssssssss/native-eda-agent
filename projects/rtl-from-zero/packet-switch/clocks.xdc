create_clock -name clk -period 10.000 [get_ports clk]
set_input_delay -clock clk 2.000 [get_ports {rst clear_stats s_data[*] s_keep[*] s_last[*] s_dest[*] s_valid[*] m_ready[*]}]
set_output_delay -clock clk 2.000 [get_ports {s_ready[*] m_data[*] m_keep[*] m_last[*] m_source[*] m_valid[*] packet_count[*] byte_count[*]}]
