`timescale 1ns/1ps
`default_nettype none
// Ready/valid AES accelerator. Key updates are barriers: all accepted blocks
// and their results drain before a new key is accepted. Reset flushes queues.
module aes_stream_top (
    input wire clk,
    input wire rst,
    input wire [255:0] key_data,
    input wire key_256,
    input wire key_valid,
    output wire key_ready,
    input wire [127:0] s_data,
    input wire s_encrypt,
    input wire [15:0] s_tag,
    input wire s_last,
    input wire s_valid,
    output wire s_ready,
    output wire [127:0] m_data,
    output wire [15:0] m_tag,
    output wire m_last,
    output wire m_valid,
    input wire m_ready,
    output wire key_loaded,
    output wire busy
);
    localparam [3:0] UNKEYED=0, INIT_PULSE=1, INIT_LOW=2, INIT_HIGH=3,
                     IDLE=4, NEXT_PULSE=5, NEXT_LOW=6, NEXT_HIGH=7;
    reg [3:0] state;
    reg [255:0] key_reg;
    reg keylen_reg;
    reg [127:0] block_reg;
    reg encrypt_reg;
    reg [15:0] tag_reg;
    reg last_reg;
    reg loaded_reg;
    reg [145:0] in_mem [0:7];
    reg [144:0] out_mem [0:7];
    reg [2:0] in_wr, in_rd, out_wr, out_rd;
    reg [3:0] in_count, out_count;
    wire core_ready, core_valid;
    wire [127:0] core_result;
    wire key_fire = key_valid && key_ready;
    wire in_push = s_valid && s_ready;
    wire in_pop = state == IDLE && in_count != 0 && out_count != 8;
    wire out_push = state == NEXT_HIGH && core_ready && core_valid;
    wire out_pop = m_valid && m_ready;

    assign key_ready = !rst && (state == UNKEYED || state == IDLE)
                       && in_count == 0 && out_count == 0;
    assign s_ready = !rst && loaded_reg && !key_valid && in_count != 8;
    assign {m_last,m_tag,m_data} = out_mem[out_rd];
    assign m_valid = !rst && out_count != 0;
    assign key_loaded = loaded_reg;
    assign busy = state != IDLE && state != UNKEYED || in_count != 0 || out_count != 0;

    aes_core cipher (
        .clk(clk), .reset_n(!rst), .encdec(encrypt_reg),
        .init(state == INIT_PULSE), .next(state == NEXT_PULSE),
        .ready(core_ready), .key(key_reg), .keylen(keylen_reg),
        .block(block_reg), .result(core_result), .result_valid(core_valid)
    );

    always @(posedge clk) begin
        if (rst) begin
            state <= UNKEYED;
            key_reg <= 0; keylen_reg <= 0; loaded_reg <= 0;
            block_reg <= 0; encrypt_reg <= 0; tag_reg <= 0; last_reg <= 0;
            in_wr <= 0; in_rd <= 0; out_wr <= 0; out_rd <= 0;
            in_count <= 0; out_count <= 0;
        end else begin
            case ({in_push,in_pop})
                2'b10: in_count <= in_count + 1'b1;
                2'b01: in_count <= in_count - 1'b1;
                default: ;
            endcase
            case ({out_push,out_pop})
                2'b10: out_count <= out_count + 1'b1;
                2'b01: out_count <= out_count - 1'b1;
                default: ;
            endcase
            if (in_push) begin
                in_mem[in_wr] <= {s_last,s_tag,s_encrypt,s_data};
                in_wr <= in_wr + 1'b1;
            end
            if (in_pop) begin
                {last_reg,tag_reg,encrypt_reg,block_reg} <= in_mem[in_rd];
                in_rd <= in_rd + 1'b1;
            end
            if (out_push) begin
                out_mem[out_wr] <= {last_reg,tag_reg,core_result};
                out_wr <= out_wr + 1'b1;
            end
            if (out_pop) out_rd <= out_rd + 1'b1;
            case (state)
                UNKEYED, IDLE: begin
                    if (key_fire) begin
                        key_reg <= key_data;
                        keylen_reg <= key_256;
                        loaded_reg <= 0;
                        state <= INIT_PULSE;
                    end else if (in_pop) state <= NEXT_PULSE;
                end
                INIT_PULSE: state <= INIT_LOW;
                INIT_LOW: if (!core_ready) state <= INIT_HIGH;
                INIT_HIGH: if (core_ready) begin
                    loaded_reg <= 1;
                    state <= IDLE;
                end
                NEXT_PULSE: state <= NEXT_LOW;
                NEXT_LOW: if (!core_ready) state <= NEXT_HIGH;
                NEXT_HIGH: if (core_ready && core_valid) state <= IDLE;
                default: state <= UNKEYED;
            endcase
        end
    end
endmodule
`default_nettype wire
