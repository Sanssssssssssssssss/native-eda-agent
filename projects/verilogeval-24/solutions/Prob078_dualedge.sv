`timescale 1ps/1ps
module TopModule(input clk, input d, output q);
    reg rising, falling;
    always @(posedge clk) rising <= d;
    always @(negedge clk) falling <= d;
    assign q = clk ? rising : falling;
endmodule
