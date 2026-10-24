`timescale 1ps/1ps
module TopModule(input clk,a,b, output q, output reg state);
assign q = a ^ b ^ state;
always @(posedge clk) begin
    if (a == b) state <= a;
end
endmodule
