`timescale 1ps/1ps
module TopModule(input clk, input reset, input [31:0] in, output reg [31:0] out);
    reg [31:0] previous;
    always @(posedge clk) begin
        previous <= in;
        if (reset) out <= 0;
        else out <= out | (previous & ~in);
    end
endmodule
