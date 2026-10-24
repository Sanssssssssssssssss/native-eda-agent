`timescale 1ps/1ps
module TopModule(input clk, input reset, output reg [31:0] q);
    always @(posedge clk)
        if (reset) q <= 32'h1;
        else q <= (q >> 1) ^ ({32{q[0]}} & 32'h80200003);
endmodule
