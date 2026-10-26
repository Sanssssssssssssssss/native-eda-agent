module z_packet_switch (
    input  wire         clk,
    input  wire         rst,
    input  wire         clear_stats,
    input  wire [255:0] s_data,
    input  wire [31:0]  s_keep,
    input  wire [3:0]   s_last,
    input  wire [7:0]   s_dest,
    input  wire [3:0]   s_valid,
    output wire [3:0]   s_ready,
    output wire [255:0] m_data,
    output wire [31:0]  m_keep,
    output wire [3:0]   m_last,
    output wire [7:0]   m_source,
    output wire [3:0]   m_valid,
    input  wire [3:0]   m_ready,
    output wire [127:0] packet_count,
    output wire [127:0] byte_count
);
endmodule
