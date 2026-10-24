`timescale 1ps/1ps
module TopModule(input clk, input load, input [9:0] data, output tc);
    reg [9:0] remaining;
    always @(posedge clk)
        if (load) remaining <= data;
        else if (remaining != 0) remaining <= remaining - 1'b1;
    assign tc = remaining == 0;
endmodule
