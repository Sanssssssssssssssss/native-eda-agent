`timescale 1ps/1ps
module TopModule(input clk, input reset, input in, output reg disc,
                 output reg flag, output reg err);
    reg [2:0] ones;
    always @(posedge clk) begin
        if (reset) begin ones <= 0; disc <= 0; flag <= 0; err <= 0; end
        else begin
            disc <= !in && ones == 5;
            flag <= !in && ones == 6;
            err <= in && ones >= 6;
            if (!in) ones <= 0;
            else if (ones != 7) ones <= ones + 1'b1;
        end
    end
endmodule
