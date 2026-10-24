`timescale 1ps/1ps
module TopModule(input clk, input in, input reset, output reg [7:0] out_byte,
                 output reg done);
    localparam IDLE=0, DATA=1, STOP=2, RECOVER=3;
    reg [1:0] state;
    reg [2:0] bit_index;
    reg [7:0] received;
    always @(posedge clk) begin
        if (reset) begin state <= IDLE; done <= 0; bit_index <= 0; received <= 0; out_byte <= 0; end
        else begin
            done <= 0;
            case (state)
                IDLE: if (!in) begin state <= DATA; bit_index <= 0; end
                DATA: begin
                    received[bit_index] <= in;
                    if (bit_index == 7) state <= STOP;
                    else bit_index <= bit_index + 1'b1;
                end
                STOP: begin
                    if (in) begin done <= 1; out_byte <= received; state <= IDLE; end
                    else state <= RECOVER;
                end
                RECOVER: if (in) state <= IDLE;
                default: state <= IDLE;
            endcase
        end
    end
endmodule
