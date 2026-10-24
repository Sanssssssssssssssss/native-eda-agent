`timescale 1ps/1ps
module TopModule(input clk,reset, output [2:0] ena, output reg [15:0] q);
assign ena[0] = q[3:0] == 9;
assign ena[1] = ena[0] && q[7:4] == 9;
assign ena[2] = ena[1] && q[11:8] == 9;
always @(posedge clk) begin
    if (reset) q <= 0;
    else begin
        q[3:0] <= q[3:0] == 9 ? 0 : q[3:0]+1'b1;
        if (ena[0]) q[7:4] <= q[7:4] == 9 ? 0 : q[7:4]+1'b1;
        if (ena[1]) q[11:8] <= q[11:8] == 9 ? 0 : q[11:8]+1'b1;
        if (ena[2]) q[15:12] <= q[15:12] == 9 ? 0 : q[15:12]+1'b1;
    end
end
endmodule
