`timescale 1ps/1ps
module TopModule(input [7:0] in, output reg [2:0] pos);
    integer i;
    always @* begin
        pos = 0;
        for (i = 7; i >= 0; i = i-1)
            if (in[i]) pos = i;
    end
endmodule
