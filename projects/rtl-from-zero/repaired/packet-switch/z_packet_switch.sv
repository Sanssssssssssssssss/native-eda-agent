`timescale 1ns/1ps
//======================================================================
// z_packet_switch : 4x4 queued packet switch, built from the interface
// only stub.  Interface, protocol, ordering, fairness, counters and
// reset semantics follow SPEC.md exactly.
//
// Structure
//   * one 16-entry first-word-fall-through header FIFO per input, storing
//     data / keep / last / destination.  ready follows capacity only.
//   * per-input ownership: each input belongs to the output serving its
//     packet until that output's LAST beat handshakes; eligibility of other
//     outputs is gated by it, and a released input may be claimed again on
//     the very same edge (one beat/cycle preserved).
//   * per-output registered output beat that holds payload / control
//     while stalled and is offered independently of downstream ready.
//   * per-output round-robin packet arbitration.  The chosen source is
//     latched (ownership) until the packet's last-beat handshake, so a
//     packet is never interleaved and input order is preserved.
//   * per-output 32-bit packet and byte counters.  clear_stats has
//     priority over an increment at the same edge.
//   * synchronous active-high reset empties FIFOs, pending output beats,
//     ownership state and counters; inputs are not accepted during reset.
//======================================================================
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

    //------------------------------------------------------------------
    // per-input FIFO interfaces
    //------------------------------------------------------------------
    wire [63:0] fifo_rdata [0:3];
    wire [7:0]  fifo_rkeep [0:3];
    wire        fifo_rlast [0:3];
    wire [1:0]  fifo_rdest [0:3];
    wire        fifo_full  [0:3];
    wire        fifo_empty [0:3];

    wire [3:0]  fifo_push;
    reg  [3:0]  fifo_pop;

    //------------------------------------------------------------------
    // registered output beat + per-output arbitration state
    //------------------------------------------------------------------
    reg         out_valid [0:3];
    reg  [63:0] out_data  [0:3];
    reg  [7:0]  out_keep  [0:3];
    reg         out_last  [0:3];
    reg  [1:0]  out_src   [0:3];
    reg         out_lock  [0:3];   // packet ownership active
    reg  [1:0]  out_lsrc  [0:3];   // owned input
    reg  [1:0]  out_rr    [0:3];   // round-robin start for next packet

    // per-input ownership: an input belongs to the output that is still
    // serving its packet, until that output's LAST beat handshakes
    reg         own_en    [0:3];   // ownership valid for this input
    reg  [1:0]  own_out   [0:3];   // owning output

    reg  [31:0] pkt_count [0:3];
    reg  [31:0] byte_cnt  [0:3];

    //------------------------------------------------------------------
    // combinational arbitration decision
    //------------------------------------------------------------------
    reg         o_fire [0:3];
    reg         o_end  [0:3];
    reg         o_cont [0:3];
    reg         o_load [0:3];
    reg  [1:0]  o_win  [0:3];
    reg  [1:0]  o_src  [0:3];

    // Eligibility matrix: built with sixteen statically indexed continuous
    // expressions (constant output index, constant input index).  No dynamic
    // partial left-hand side and no procedural write scheduling is involved,
    // so every mask bit is a pure function of fifo_empty / fifo_rdest.
    wire [3:0]  o_elig [0:3];

    // ownership-gated eligibility and same-edge release flags
    reg  [3:0]  o_elig_v [0:3];
    reg         o_rel    [0:3];

    assign o_elig[0][0] = ~fifo_empty[0] & (fifo_rdest[0] == 2'd0);
    assign o_elig[0][1] = ~fifo_empty[1] & (fifo_rdest[1] == 2'd0);
    assign o_elig[0][2] = ~fifo_empty[2] & (fifo_rdest[2] == 2'd0);
    assign o_elig[0][3] = ~fifo_empty[3] & (fifo_rdest[3] == 2'd0);

    assign o_elig[1][0] = ~fifo_empty[0] & (fifo_rdest[0] == 2'd1);
    assign o_elig[1][1] = ~fifo_empty[1] & (fifo_rdest[1] == 2'd1);
    assign o_elig[1][2] = ~fifo_empty[2] & (fifo_rdest[2] == 2'd1);
    assign o_elig[1][3] = ~fifo_empty[3] & (fifo_rdest[3] == 2'd1);

    assign o_elig[2][0] = ~fifo_empty[0] & (fifo_rdest[0] == 2'd2);
    assign o_elig[2][1] = ~fifo_empty[1] & (fifo_rdest[1] == 2'd2);
    assign o_elig[2][2] = ~fifo_empty[2] & (fifo_rdest[2] == 2'd2);
    assign o_elig[2][3] = ~fifo_empty[3] & (fifo_rdest[3] == 2'd2);

    assign o_elig[3][0] = ~fifo_empty[0] & (fifo_rdest[0] == 2'd3);
    assign o_elig[3][1] = ~fifo_empty[1] & (fifo_rdest[1] == 2'd3);
    assign o_elig[3][2] = ~fifo_empty[2] & (fifo_rdest[2] == 2'd3);
    assign o_elig[3][3] = ~fifo_empty[3] & (fifo_rdest[3] == 2'd3);

    // first eligible input at or after "start", wrapping modulo four
    function [1:0] rr_pick;
        input [1:0] start;
        input [3:0] elig;
        integer     k;
        reg         found;
        reg  [1:0]  sel;
        begin
            found = 1'b0;
            sel   = 2'd0;
            for (k = 0; k < 4; k = k + 1) begin
                if (!found && elig[(start + k) & 2'd3]) begin
                    sel   = (start + k) & 2'd3;
                    found = 1'b1;
                end
            end
            rr_pick = sel;
        end
    endfunction

    // byte population count of an 8-bit keep mask
    function [3:0] popcount8;
        input [7:0] v;
        integer     b;
        begin
            popcount8 = 4'd0;
            for (b = 0; b < 8; b = b + 1)
                popcount8 = popcount8 + v[b];
        end
    endfunction

    //------------------------------------------------------------------
    // input acceptance: ready reflects FIFO capacity only, never payload
    //------------------------------------------------------------------
    genvar gi;
    generate
        for (gi = 0; gi < 4; gi = gi + 1) begin : g_in
            assign s_ready[gi]  = ~rst & ~fifo_full[gi];
            assign fifo_push[gi] = s_valid[gi] & s_ready[gi];

            zeda_packet_fifo16 u_fifo (
                .clk    (clk),
                .rst    (rst),
                .push   (fifo_push[gi]),
                .pop    (fifo_pop[gi]),
                .w_data (s_data[gi*64 +: 64]),
                .w_keep (s_keep[gi*8 +: 8]),
                .w_last (s_last[gi]),
                .w_dest (s_dest[gi*2 +: 2]),
                .r_data (fifo_rdata[gi]),
                .r_keep (fifo_rkeep[gi]),
                .r_last (fifo_rlast[gi]),
                .r_dest (fifo_rdest[gi]),
                .full   (fifo_full[gi]),
                .empty  (fifo_empty[gi])
            );
        end
    endgenerate

    //------------------------------------------------------------------
    // arbitration + load decision
    //   o_cont  : keep serving the owned packet
    //   o_load  : latch the next beat into the output register
    //------------------------------------------------------------------
    always_comb begin
        // current-cycle transfer decisions first: o_fire / o_end / o_cont
        // are pure functions of registered state and m_ready, so they must
        // be computed BEFORE any ownership-release or eligibility logic
        // consumes them (within a single always_comb pass each statement
        // sees the value left by the previous evaluation otherwise)
        for (int oo = 0; oo < 4; oo = oo + 1) begin
            o_fire[oo] = out_valid[oo] & m_ready[oo];
            o_end[oo]  = o_fire[oo] & out_last[oo];
            o_cont[oo] = out_lock[oo] & ~o_end[oo];
        end

        // release flags: an input leaves its owner on the edge where the
        // owner's LAST beat handshakes, so it can be claimed again on that
        // same edge without a bubble
        for (int ii = 0; ii < 4; ii = ii + 1) begin
            o_rel[ii] = 1'b0;
            for (int oo = 0; oo < 4; oo = oo + 1)
                if (own_en[ii] && (own_out[ii] == oo[1:0]) && o_end[oo])
                    o_rel[ii] = 1'b1;
        end

        // static eligibility matrix gated by input ownership: a bit stays
        // high for the owning output, for an unowned input, or for an input
        // being released on this edge
        for (int oo = 0; oo < 4; oo = oo + 1)
            for (int ii = 0; ii < 4; ii = ii + 1)
                o_elig_v[oo][ii] = o_elig[oo][ii] &
                    (~own_en[ii] | (own_out[ii] == oo[1:0]) | o_rel[ii]);

        for (int oo = 0; oo < 4; oo = oo + 1) begin
            o_win[oo] = rr_pick(out_rr[oo], o_elig_v[oo]);
            o_src[oo] = o_cont[oo] ? out_lsrc[oo] : o_win[oo];

            o_load[oo] = (o_cont[oo] | (|o_elig_v[oo])) &
                         (~out_valid[oo] | o_fire[oo]) &
                         (~fifo_empty[o_src[oo]] &
                          (fifo_rdest[o_src[oo]] == oo[1:0]));
        end

        for (int ii = 0; ii < 4; ii = ii + 1) begin
            fifo_pop[ii] = 1'b0;
            for (int oo = 0; oo < 4; oo = oo + 1)
                if (o_load[oo] && (o_src[oo] == ii[1:0]))
                    fifo_pop[ii] = 1'b1;
        end
    end

    //------------------------------------------------------------------
    // output registers, ownership, round-robin pointer, counters
    //------------------------------------------------------------------
    always @(posedge clk) begin
        if (rst) begin
            for (int oo = 0; oo < 4; oo = oo + 1) begin
                out_valid[oo] <= 1'b0;
                out_data[oo]  <= 64'd0;
                out_keep[oo]  <= 8'd0;
                out_last[oo]  <= 1'b0;
                out_src[oo]   <= 2'd0;
                out_lock[oo]  <= 1'b0;
                out_lsrc[oo]  <= 2'd0;
                out_rr[oo]    <= 2'd0;
                own_en[oo]    <= 1'b0;
                own_out[oo]   <= 2'd0;
                pkt_count[oo] <= 32'd0;
                byte_cnt[oo]  <= 32'd0;
            end
        end else begin
            for (int oo = 0; oo < 4; oo = oo + 1) begin
                if (o_load[oo]) begin
                    out_valid[oo] <= 1'b1;
                    out_data[oo]  <= fifo_rdata[o_src[oo]];
                    out_keep[oo]  <= fifo_rkeep[o_src[oo]];
                    out_last[oo]  <= fifo_rlast[o_src[oo]];
                    out_src[oo]   <= o_src[oo];
                    out_lock[oo]  <= 1'b1;
                    if (!o_cont[oo]) begin
                        out_lsrc[oo] <= o_src[oo];
                        out_rr[oo]   <= o_src[oo] + 2'd1;
                    end
                end else if (o_fire[oo]) begin
                    out_valid[oo] <= 1'b0;
                    if (o_end[oo])
                        out_lock[oo] <= 1'b0;
                end

                if (clear_stats) begin
                    pkt_count[oo] <= 32'd0;
                    byte_cnt[oo]  <= 32'd0;
                end else if (o_fire[oo]) begin
                    byte_cnt[oo] <= byte_cnt[oo] + popcount8(out_keep[oo]);
                    if (out_last[oo])
                        pkt_count[oo] <= pkt_count[oo] + 32'd1;
                end
            end

            // release ownership when the owning output's LAST beat handshakes.
            // All releases run BEFORE all claims below, so a claim always wins
            // over a release of the same input on this edge, regardless of
            // output index order
            for (int oo = 0; oo < 4; oo = oo + 1) begin
                if (out_lock[oo] && o_end[oo]) begin
                    case (out_lsrc[oo])
                        2'd0: own_en[0] <= 1'b0;
                        2'd1: own_en[1] <= 1'b0;
                        2'd2: own_en[2] <= 1'b0;
                        default: own_en[3] <= 1'b0;
                    endcase
                end
            end

            // claim ownership on a new packet's first beat; written after the
            // release loop so an input released on this edge may be claimed
            // again on the same edge (no bubble, claim sticks)
            for (int oo = 0; oo < 4; oo = oo + 1) begin
                if (o_load[oo] && !o_cont[oo]) begin
                    case (o_src[oo])
                        2'd0: begin own_en[0] <= 1'b1; own_out[0] <= oo[1:0]; end
                        2'd1: begin own_en[1] <= 1'b1; own_out[1] <= oo[1:0]; end
                        2'd2: begin own_en[2] <= 1'b1; own_out[2] <= oo[1:0]; end
                        default: begin own_en[3] <= 1'b1; own_out[3] <= oo[1:0]; end
                    endcase
                end
            end
        end
    end

    //------------------------------------------------------------------
    // output ports
    //------------------------------------------------------------------
    genvar go;
    generate
        for (go = 0; go < 4; go = go + 1) begin : g_out
            assign m_valid[go]              = out_valid[go];
            assign m_last[go]               = out_last[go];
            assign m_data[go*64 +: 64]      = out_data[go];
            assign m_keep[go*8 +: 8]        = out_keep[go];
            assign m_source[go*2 +: 2]      = out_src[go];
            assign packet_count[go*32 +: 32] = pkt_count[go];
            assign byte_count[go*32 +: 32]   = byte_cnt[go];
        end
    endgenerate

endmodule


//======================================================================
// 16-deep first-word-fall-through header FIFO.
// The read port is combinational (distributed RAM); a written word is
// visible on r_data on the cycle after push.  Pointer/count bookkeeping
// is synchronous so push and pop may happen together at one beat/cycle.
//======================================================================
module zeda_packet_fifo16 (
    input  wire        clk,
    input  wire        rst,
    input  wire        push,
    input  wire        pop,
    input  wire [63:0] w_data,
    input  wire [7:0]  w_keep,
    input  wire        w_last,
    input  wire [1:0]  w_dest,
    output wire [63:0] r_data,
    output wire [7:0]  r_keep,
    output wire        r_last,
    output wire [1:0]  r_dest,
    output wire        full,
    output wire        empty
);
    localparam integer DEPTH = 16;
    localparam integer AW    = 4;

    (* ram_style = "distributed" *) reg [63:0] mem_data [0:DEPTH-1];
    (* ram_style = "distributed" *) reg [7:0]  mem_keep [0:DEPTH-1];
    (* ram_style = "distributed" *) reg        mem_last [0:DEPTH-1];
    (* ram_style = "distributed" *) reg [1:0]  mem_dest [0:DEPTH-1];

    reg [AW:0] wptr;
    reg [AW:0] rptr;
    reg [AW:0] count;

    wire do_push = push & ~full;
    wire do_pop  = pop  & ~empty;

    always @(posedge clk) begin
        if (rst) begin
            wptr  <= {(AW+1){1'b0}};
            rptr  <= {(AW+1){1'b0}};
            count <= {(AW+1){1'b0}};
        end else begin
            if (do_push) begin
                mem_data[wptr[AW-1:0]] <= w_data;
                mem_keep[wptr[AW-1:0]] <= w_keep;
                mem_last[wptr[AW-1:0]] <= w_last;
                mem_dest[wptr[AW-1:0]] <= w_dest;
                wptr <= wptr + 1'b1;
            end
            if (do_pop)
                rptr <= rptr + 1'b1;

            if (do_push && !do_pop)
                count <= count + 1'b1;
            else if (!do_push && do_pop)
                count <= count - 1'b1;
        end
    end

    assign r_data = mem_data[rptr[AW-1:0]];
    assign r_keep = mem_keep[rptr[AW-1:0]];
    assign r_last = mem_last[rptr[AW-1:0]];
    assign r_dest = mem_dest[rptr[AW-1:0]];

    assign empty = (count == 0);
    assign full  = (count == DEPTH);

endmodule
