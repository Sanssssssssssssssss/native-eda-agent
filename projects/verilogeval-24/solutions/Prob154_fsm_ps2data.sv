`timescale 1ps/1ps
module TopModule(input clk, input reset, input [7:0] in,
                 output reg [23:0] out_bytes, output reg done);
    reg [1:0] phase;
    reg [15:0] prefix;
    always @(posedge clk) begin
        if (reset) begin phase <= 0; done <= 0; prefix <= 0; out_bytes <= 0; end
        else begin
            done <= 0;
            case (phase)
                0: if (in[3]) begin prefix[15:8] <= in; phase <= 1; end
                1: begin prefix[7:0] <= in; phase <= 2; end
                2: begin out_bytes <= {prefix,in}; done <= 1; phase <= 0; end
                default: phase <= 0;
            endcase
        end
    end
endmodule
