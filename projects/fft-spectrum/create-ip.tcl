create_ip -name xfft -vendor xilinx.com -library ip -version 9.1 -module_name xfft_0
set_property -dict [list \
    CONFIG.transform_length 1024 CONFIG.implementation_options pipelined_streaming_io \
    CONFIG.target_clock_frequency 100 CONFIG.input_width 16 CONFIG.phase_factor_width 16 \
    CONFIG.scaling_options scaled CONFIG.rounding_modes convergent_rounding \
    CONFIG.output_ordering natural_order CONFIG.throttle_scheme nonrealtime CONFIG.aresetn true \
    CONFIG.memory_options_data block_ram CONFIG.memory_options_phase_factors block_ram \
    CONFIG.memory_options_reorder block_ram] [get_ips xfft_0]
