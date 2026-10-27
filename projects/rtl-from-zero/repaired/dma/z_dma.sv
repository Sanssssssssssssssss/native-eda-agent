// -----------------------------------------------------------------------------
// z_dma : queued AXI4 (64-bit, INCR, SIZE=3) memory-to-memory DMA.
//
// Written from the interface-only shell and the fixed SPEC. No vendor/IP code.
//
// Structure
//   * Descriptor FIFO      : 8 entries, accepts descriptors while a transfer is
//                            active and while a completion is stalled, in order.
//   * S_PLAN pipeline stage: computes and REGISTERS the whole chunk payload
//                            (AR address/len, AW address/len, byte count, final
//                            WSTRB). This keeps the min3 / 4 KiB-boundary /
//                            address logic register-to-register instead of
//                            ending at an output port with IO delay.
//   * Single AXI engine    : one outstanding transaction. Per chunk it issues
//                            exactly one AR, drains the whole R burst into a
//                            16-beat local buffer, then issues the matching AW
//                            followed by the W beats, then consumes B.
//   * Completion interface : status_valid/status_tag/status_error held stable
//                            until accepted; tag/error preserved under stalls.
//   * Error handling       : nonzero RRESP -> drain the burst, write nothing,
//                            finish with error=1. Nonzero BRESP -> finish with
//                            error=1 and stop further chunks.
//   * Reset                : synchronous active-high; clears active work, the
//                            FIFO, the chunk buffer state and all valid outputs.
//
// Chunk sizing obeys: 1..16 beats, never beyond the final rounded beat, and both
// the source and destination 8-byte beats stay inside one 4 KiB region.
// -----------------------------------------------------------------------------
`timescale 1ns/1ps
module z_dma (
    input  wire        clk,
    input  wire        rst,
    input  wire        desc_valid,
    output wire        desc_ready,
    input  wire [31:0] desc_src,
    input  wire [31:0] desc_dst,
    input  wire [15:0] desc_len,
    input  wire [7:0]  desc_tag,
    output wire        status_valid,
    input  wire        status_ready,
    output wire [7:0]  status_tag,
    output wire        status_error,
    output wire [31:0] m_axi_araddr,
    output wire [7:0]  m_axi_arlen,
    output wire [2:0]  m_axi_arsize,
    output wire [1:0]  m_axi_arburst,
    output wire        m_axi_arvalid,
    input  wire        m_axi_arready,
    input  wire [63:0] m_axi_rdata,
    input  wire [1:0]  m_axi_rresp,
    input  wire        m_axi_rlast,
    input  wire        m_axi_rvalid,
    output wire        m_axi_rready,
    output wire [31:0] m_axi_awaddr,
    output wire [7:0]  m_axi_awlen,
    output wire [2:0]  m_axi_awsize,
    output wire [1:0]  m_axi_awburst,
    output wire        m_axi_awvalid,
    input  wire        m_axi_awready,
    output wire [63:0] m_axi_wdata,
    output wire [7:0]  m_axi_wstrb,
    output wire        m_axi_wlast,
    output wire        m_axi_wvalid,
    input  wire        m_axi_wready,
    input  wire [1:0]  m_axi_bresp,
    input  wire        m_axi_bvalid,
    output wire        m_axi_bready
);

    // ------------------------------------------------------------------ states
    localparam [2:0] S_IDLE = 3'd0,
                     S_AR   = 3'd1,
                     S_R    = 3'd2,
                     S_AW   = 3'd3,
                     S_W    = 3'd4,
                     S_B    = 3'd5,
                     S_STAT = 3'd6,
                     S_PLAN = 3'd7;

    reg [2:0]  state;      // declared before use (fifo_pop references it)

    // ---------------------------------------------------------- descriptor FIFO
    localparam integer DEPTH = 8;      // 4 pending required; 8 pending + 1 active
    localparam integer PTRW  = 3;

    (* ram_style = "distributed" *) reg [87:0] fifo_mem [0:DEPTH-1];
    reg [PTRW:0]   fifo_cnt;
    reg [PTRW-1:0] fifo_wp, fifo_rp;

    localparam [PTRW:0] DEPTH_CNT = DEPTH;
    wire           fifo_full = (fifo_cnt == DEPTH_CNT);
    wire [87:0]    fifo_dout = fifo_mem[fifo_rp];

    assign desc_ready = ~fifo_full;
    wire fifo_push = desc_valid && desc_ready;
    wire fifo_pop  = ((state == S_IDLE) && (fifo_cnt != 0)) ||
                     ((state == S_STAT) && status_ready && (fifo_cnt != 0));

    // ------------------------------------------------------------------ engine
    reg [31:0] a_src, a_dst;
    reg [15:0] a_len, a_off;
    reg [7:0]  a_tag;
    reg        a_err;          // sticky per-descriptor error (status_error)
    reg        rerr;           // sticky error within the current read burst

    // registered chunk payload (latched in S_PLAN, held through AR/AW/W/B)
    reg [31:0] c_araddr, c_awaddr;
    reg [4:0]  c_beats;        // beats in the current chunk (1..16)
    reg [4:0]  c_len;          // c_beats - 1
    reg [15:0] c_bytes;        // bytes copied by the current chunk
    reg [4:0]  rd_idx, wr_idx;

    reg [63:0] rbuf [0:15];    // read burst staging, 16 * 64-bit

    // ------------------------------------------------ current chunk arithmetic
    wire [31:0] src_addr = a_src + {16'd0, a_off};
    wire [31:0] dst_addr = a_dst + {16'd0, a_off};
    wire [15:0] rem      = a_len - a_off;

    // ceil(rem/8)
    wire [12:0] rem_p7    = {1'b0, rem[12:0]} + 13'd7;
    wire [9:0]  rem_beats = rem_p7[12:3];

    // beats that keep the whole 8-byte beat inside the 4 KiB region
    wire [9:0]  src_lim = 10'd512 - {7'd0, src_addr[11:3]};
    wire [9:0]  dst_lim = 10'd512 - {7'd0, dst_addr[11:3]};

    function automatic [9:0] min3(input [9:0] x, input [9:0] y, input [9:0] z);
        begin
            min3 = (x < y) ? ((x < z) ? x : z) : ((y < z) ? y : z);
        end
    endfunction

    wire [9:0]  lim         = min3(rem_beats, src_lim, dst_lim);
    wire [4:0]  beats       = (lim > 10'd16) ? 5'd16 : lim[4:0];
    wire [15:0] beat_bytes  = {11'd0, beats, 3'd0};
    wire [15:0] chunk_bytes = (beat_bytes > rem) ? rem : beat_bytes;

    // Final-beat WSTRB, derived from the REGISTERED chunk byte count instead of
    // from a fresh rem/beat_bytes subtraction chain. chunk_bytes has at most one
    // partial beat, and c_bytes[2:0] is exactly that beat's byte count
    // (0 means the last beat is a full 8 bytes). Keeping this a short
    // register-to-output function removes the deep subtract/shift chain from the
    // 100 MHz setup path.
    wire [2:0]  c_tail_bits = c_bytes[2:0];
    wire [7:0]  last_strb   = (c_tail_bits == 3'd0) ? 8'hFF
                                                    : ((8'h01 << c_tail_bits) - 8'h01);

    // -------------------------------------------------------------- AXI outputs
    // All payloads come from registers; only state/index muxing is combinational.
    assign m_axi_araddr  = c_araddr;
    assign m_axi_arlen   = {3'b000, c_len};
    assign m_axi_arsize  = 3'd3;      // 8 bytes
    assign m_axi_arburst = 2'd1;      // INCR
    assign m_axi_arvalid = (state == S_AR);

    assign m_axi_rready  = (state == S_R);

    assign m_axi_awaddr  = c_awaddr;
    assign m_axi_awlen   = {3'b000, c_len};
    assign m_axi_awsize  = 3'd3;
    assign m_axi_awburst = 2'd1;
    assign m_axi_awvalid = (state == S_AW);

    assign m_axi_wdata   = rbuf[wr_idx[3:0]];
    assign m_axi_wstrb   = (wr_idx == c_len) ? last_strb : 8'hFF;
    assign m_axi_wlast   = (wr_idx == c_len);
    assign m_axi_wvalid  = (state == S_W);

    assign m_axi_bready  = (state == S_B);

    assign status_valid  = (state == S_STAT);
    assign status_tag    = a_tag;
    assign status_error  = a_err;

    // -------------------------------------------------------------- FIFO update
    always_ff @(posedge clk) begin
        if (rst) begin
            fifo_cnt <= {(PTRW+1){1'b0}};
            fifo_wp  <= {PTRW{1'b0}};
            fifo_rp  <= {PTRW{1'b0}};
        end else begin
            if (fifo_push) begin
                fifo_mem[fifo_wp] <= {desc_src, desc_dst, desc_len, desc_tag};
                fifo_wp <= fifo_wp + {{(PTRW-1){1'b0}}, 1'b1};
            end
            if (fifo_pop)
                fifo_rp <= fifo_rp + {{(PTRW-1){1'b0}}, 1'b1};
            case ({fifo_push, fifo_pop})
                2'b10:   fifo_cnt <= fifo_cnt + {{PTRW{1'b0}}, 1'b1};
                2'b01:   fifo_cnt <= fifo_cnt - {{PTRW{1'b0}}, 1'b1};
                default: fifo_cnt <= fifo_cnt;
            endcase
        end // push/pop
    end

    // ------------------------------------------------------------------- engine
    always_ff @(posedge clk) begin
        if (rst) begin
            state       <= S_IDLE;
            a_src       <= 32'd0;
            a_dst       <= 32'd0;
            a_len       <= 16'd0;
            a_off       <= 16'd0;
            a_tag       <= 8'd0;
            a_err       <= 1'b0;
            rerr        <= 1'b0;
            c_araddr    <= 32'd0;
            c_awaddr    <= 32'd0;
            c_beats     <= 5'd0;
            c_len       <= 5'd0;
            c_bytes     <= 16'd0;
            rd_idx      <= 5'd0;
            wr_idx      <= 5'd0;
        end else begin
            case (state)

                // Pop the next descriptor (order preserved by the FIFO).
                S_IDLE: begin
                    if (fifo_cnt != 0) begin
                        a_src <= fifo_dout[87:56];
                        a_dst <= fifo_dout[55:24];
                        a_len <= fifo_dout[23:8];
                        a_tag <= fifo_dout[7:0];
                        a_off <= 16'd0;
                        a_err <= 1'b0;
                        rerr  <= 1'b0;
                        state <= S_PLAN;
                    end
                end

                // Compute and register the whole chunk payload (timing pipeline).
                S_PLAN: begin
                    c_araddr    <= src_addr;
                    c_awaddr    <= dst_addr;
                    c_beats     <= beats;
                    c_len       <= beats - 5'd1;
                    c_bytes     <= chunk_bytes;
                    state       <= S_AR;
                end

                // One AR per chunk.
                S_AR: begin
                    if (m_axi_arready) begin
                        rd_idx <= 5'd0;
                        rerr   <= 1'b0;
                        state  <= S_R;
                    end
                end

                // Drain the whole R burst; on any error finish without writing.
                S_R: begin
                    if (m_axi_rvalid) begin
                        rbuf[rd_idx[3:0]] <= m_axi_rdata;
                        if (m_axi_rresp != 2'b00)
                            rerr <= 1'b1;
                        if (rd_idx == c_len) begin
                            if (rerr || (m_axi_rresp != 2'b00)) begin
                                a_err <= 1'b1;
                                state <= S_STAT;
                            end else begin
                                wr_idx <= 5'd0;
                                state  <= S_AW;
                            end
                        end else begin
                            rd_idx <= rd_idx + 5'd1;
                        end
                    end
                end

                // Matching write address only after a complete successful read.
                S_AW: begin
                    if (m_axi_awready) begin
                        wr_idx <= 5'd0;
                        state  <= S_W;
                    end
                end

                S_W: begin
                    if (m_axi_wready) begin
                        if (wr_idx == c_len)
                            state <= S_B;
                        else
                            wr_idx <= wr_idx + 5'd1;
                    end
                end

                S_B: begin
                    if (m_axi_bvalid) begin
                        if (m_axi_bresp != 2'b00) begin
                            a_err <= 1'b1;
                            state <= S_STAT;
                        end else if ((a_off + c_bytes) == a_len) begin
                            state <= S_STAT;
                        end else begin
                            a_off <= a_off + c_bytes;
                            state <= S_PLAN;
                        end
                    end
                end

                // Present tag/error until accepted, then start the next descriptor.
                S_STAT: begin
                    if (status_ready) begin
                        if (fifo_cnt != 0) begin
                            a_src <= fifo_dout[87:56];
                            a_dst <= fifo_dout[55:24];
                            a_len <= fifo_dout[23:8];
                            a_tag <= fifo_dout[7:0];
                            a_off <= 16'd0;
                            a_err <= 1'b0;
                            rerr  <= 1'b0;
                            state <= S_PLAN;
                        end else begin
                            state <= S_IDLE;
                        end
                    end
                end

                default: state <= S_IDLE;
            endcase
        end
    end

endmodule
