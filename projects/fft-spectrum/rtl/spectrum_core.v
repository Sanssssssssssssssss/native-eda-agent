`timescale 1ns/1ps
// ============================================================================
// spectrum_core.v
// 1024-point pipelined-streaming FFT "spectrum" datapath core.
//
// Re-implementation of the signal-processing part of
// vendor/SynthPilot_Tutorial/prj/04 (commit c415ec77d296b38c2bb384141eb9952f1eb84344,
// original target xcku3p-ffvb676-2-e / Vivado 2024.2) for
// xc7a100tfgg676-2 / Vivado 2020.2.
//
// Datapath:  real 16-bit AXI4-Stream samples -> xfft 9.1 (1024 pt,
//            pipelined_streaming_io, 16-bit input/phase, scaled,
//            convergent_rounding, natural_order, nonrealtime, aresetn)
//            -> magnitude_calc (original L1 |Re|+|Im|, saturated to 16 bit).
//
// The raw FFT complex result is exposed on fft_data in the same cycle as the
// magnitude word so the frozen testbench can check both.
//
// FFT configuration word: 16'h0557
//   bit 0        FWD/INV   = 1  (forward transform)
//   bits [10:1]  SCALE_SCH = 0x2AB = 10_10_10_10_11
//                            = 2+2+2+2+3 = 11
//   total scaling = 2^11 = 2048  ->  full-scale 1024-point DC lands on 16384
//
// Reset policy: after aresetn is released the configuration word is written
// once through the config channel and the core then waits FFT_CFG_SETTLE
// cycles before the data channel is opened.  No frame is pre-rolled and the
// very first post-reset frame is a real accepted frame, never a dummy one.
// ============================================================================

module spectrum_core (
    input  wire        clk,
    input  wire        rst_n,

    // AXI4-Stream slave : real 16-bit sample stream (1024 samples per frame)
    input  wire [15:0] s_data,
    input  wire        s_valid,
    input  wire        s_last,
    output wire        s_ready,

    // AXI4-Stream master : L1 magnitude spectrum, 1024 bins per frame
    output wire [15:0] m_data,
    output wire        m_valid,
    output wire        m_last,
    input  wire        m_ready,

    // Debug: raw FFT complex word {Im[31:16], Re[15:0]} of the same beat
    output wire [31:0] fft_data,

    // FFT input-framing error (missing OR unexpected TLAST)
    output wire        event_bad_last
);

    // ------------------------------------------------------------------
    // FFT IP configuration
    // ------------------------------------------------------------------
    localparam [15:0] FFT_CFG_WORD      = 16'h0557;
    localparam [5:0]  FFT_CFG_SETTLE    = 6'd48;   // config-to-data guard time

    // FSM states
    localparam [2:0]  ST_WAIT  = 3'd0;  // a short quiet time after aresetn
    localparam [2:0]  ST_CONFIG= 3'd1;  // push the configuration word
    localparam [2:0]  ST_SETTLE= 3'd2;  // let the configuration take effect
    localparam [2:0]  ST_RUN   = 3'd3;  // data channel open

    reg  [2:0]  state;
    reg  [2:0]  wait_cnt;
    reg  [5:0]  settle_cnt;
    reg  [15:0] cfg_tdata;
    reg         cfg_tvalid;
    reg         data_enable;

    // IP channel nets
    wire        cfg_tready;
    wire        din_tready;
    wire        dout_tvalid;
    wire        dout_tlast;
    wire [31:0] dout_tdata;
    wire        evt_tlast_missing;
    wire        evt_tlast_unexpected;

    // ------------------------------------------------------------------
    // AXI4-Stream plumbing
    // ------------------------------------------------------------------
    assign s_ready      = din_tready & data_enable;
    assign fft_data     = dout_tdata;
    assign event_bad_last = evt_tlast_missing | evt_tlast_unexpected;

    // ------------------------------------------------------------------
    // Reset / configuration sequencer
    // ------------------------------------------------------------------
    always @(posedge clk or negedge rst_n) begin
        if (!rst_n) begin
            state       <= ST_WAIT;
            wait_cnt    <= 3'd0;
            settle_cnt  <= 6'd0;
            cfg_tdata   <= FFT_CFG_WORD;
            cfg_tvalid  <= 1'b0;
            data_enable <= 1'b0;
        end else begin
            case (state)
                ST_WAIT: begin
                    data_enable <= 1'b0;
                    cfg_tvalid  <= 1'b0;
                    if (wait_cnt == 3'd3) begin
                        cfg_tdata <= FFT_CFG_WORD;
                        state     <= ST_CONFIG;
                    end else begin
                        wait_cnt  <= wait_cnt + 3'd1;
                    end
                end

                ST_CONFIG: begin
                    cfg_tvalid <= 1'b1;
                    if (cfg_tvalid && cfg_tready) begin
                        cfg_tvalid <= 1'b0;
                        settle_cnt <= FFT_CFG_SETTLE;
                        state      <= ST_SETTLE;
                    end
                end

                ST_SETTLE: begin
                    cfg_tvalid <= 1'b0;
                    if (settle_cnt == 6'd0) begin
                        data_enable <= 1'b1;
                        state       <= ST_RUN;
                    end else begin
                        settle_cnt  <= settle_cnt - 6'd1;
                    end
                end

                ST_RUN: begin
                    // configuration is static for the whole run; it survives
                    // frame boundaries (re-sent only after a reset)
                end

                default: state <= ST_WAIT;
            endcase
        end
    end

    // ------------------------------------------------------------------
    // Xilinx FFT 9.1 - 1024 point, pipelined streaming I/O
    // ------------------------------------------------------------------
    xfft_0 u_xfft (
        .aclk                          (clk),
        .aresetn                       (rst_n),

        .s_axis_config_tdata           (cfg_tdata),
        .s_axis_config_tvalid          (cfg_tvalid),
        .s_axis_config_tready          (cfg_tready),

        // real input: Re in [15:0], Im in [31:16] (driven to zero)
        .s_axis_data_tdata             ({16'b0, s_data}),
        .s_axis_data_tvalid            (s_valid & data_enable),
        .s_axis_data_tready            (din_tready),
        .s_axis_data_tlast             (s_last & data_enable),

        .m_axis_data_tdata             (dout_tdata),
        .m_axis_data_tvalid            (dout_tvalid),
        .m_axis_data_tready            (m_ready),
        .m_axis_data_tlast             (dout_tlast),

        .event_frame_started           (),
        .event_tlast_unexpected        (evt_tlast_unexpected),
        .event_tlast_missing           (evt_tlast_missing),
        .event_status_channel_halt     (),
        .event_data_in_channel_halt    (),
        .event_data_out_channel_halt   ()
    );

    // ------------------------------------------------------------------
    // Original L1 magnitude approximation (vendor .../rtl/magnitude_calc.v)
    // combinational pass-through, saturated to 16 bit
    // ------------------------------------------------------------------
    magnitude_calc u_magnitude_calc (
        .clk            (clk),
        .rst_n          (rst_n),
        .s_axis_tdata   (dout_tdata),
        .s_axis_tvalid  (dout_tvalid),
        .s_axis_tlast   (dout_tlast),
        .s_axis_tready  (),
        .m_axis_tdata   (m_data),
        .m_axis_tvalid  (m_valid),
        .m_axis_tlast   (m_last),
        .m_axis_tready  (m_ready)
    );

endmodule
