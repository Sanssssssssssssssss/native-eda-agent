`timescale 1ps/1ps
module TopModule(input clk, input reset, output reg [9:0] q);
    always @(posedge clk)
        if (reset || q == 10'd999) q <= 0;
        else q <= q + 1'b1;
endmodule
