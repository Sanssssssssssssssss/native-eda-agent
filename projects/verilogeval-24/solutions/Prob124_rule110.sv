`timescale 1ps/1ps
module TopModule(input clk, input load, input [511:0] data, output reg [511:0] q);
    wire [511:0] left = {1'b0,q[511:1]};
    wire [511:0] right = {q[510:0],1'b0};
    always @(posedge clk)
        if (load) q <= data;
        else q <= (q | right) & ~(left & q & right);
endmodule
