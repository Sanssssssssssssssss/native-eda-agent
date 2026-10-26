create_clock -name clk -period 10.000 [get_ports clk]
set_input_delay -clock clk 2.000 [get_ports -filter {DIRECTION == IN && NAME != clk}]
set_output_delay -clock clk 2.000 [get_ports -filter {DIRECTION == OUT}]
