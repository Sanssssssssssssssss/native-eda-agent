`timescale 1ps/1ps
module TopModule(input clk, input reset, input ena, output reg pm,
                 output reg [7:0] hh, output reg [7:0] mm, output reg [7:0] ss);
    function [7:0] bcd_increment(input [7:0] value);
        if (value[3:0] == 9) bcd_increment = {value[7:4]+4'd1,4'd0};
        else bcd_increment = value + 8'd1;
    endfunction
    always @(posedge clk) begin
        if (reset) begin pm <= 0; hh <= 8'h12; mm <= 0; ss <= 0; end
        else if (ena) begin
            if (ss == 8'h59) begin
                ss <= 0;
                if (mm == 8'h59) begin
                    mm <= 0;
                    if (hh == 8'h11) pm <= ~pm;
                    hh <= hh == 8'h12 ? 8'h01 : bcd_increment(hh);
                end else mm <= bcd_increment(mm);
            end else ss <= bcd_increment(ss);
        end
    end
endmodule
