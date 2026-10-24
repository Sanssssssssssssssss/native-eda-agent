`timescale 1ps/1ps
module TopModule(input clk, input areset, input train_valid,
                 input train_taken, output reg [1:0] state);
    always @(posedge clk or posedge areset) begin
        if (areset) state <= 2'b01;
        else if (train_valid) begin
            if (train_taken && state != 3) state <= state + 1'b1;
            else if (!train_taken && state != 0) state <= state - 1'b1;
        end
    end
endmodule
