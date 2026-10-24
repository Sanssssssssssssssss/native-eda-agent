`timescale 1ps/1ps
module TopModule(input clk, input areset, input predict_valid, input [6:0] predict_pc,
                 output predict_taken, output [6:0] predict_history,
                 input train_valid, input train_taken, input train_mispredicted,
                 input [6:0] train_history, input [6:0] train_pc);
    reg [6:0] history;
    reg [1:0] pht [0:127];
    wire [6:0] predict_index = predict_pc ^ history;
    wire [6:0] train_index = train_pc ^ train_history;
    integer i;
    assign predict_history = history;
    assign predict_taken = pht[predict_index][1];
    always @(posedge clk or posedge areset) begin
        if (areset) begin
            history <= 0;
            // Prompt omits reset values; choose empty history and weakly not taken.
            for (i = 0; i < 128; i = i+1) pht[i] <= 2'b01;
        end else begin
            if (train_valid && train_mispredicted) history <= {train_history[5:0],train_taken};
            else if (predict_valid) history <= {history[5:0],predict_taken};
            if (train_valid) begin
                if (train_taken && pht[train_index] != 3) pht[train_index] <= pht[train_index] + 1'b1;
                else if (!train_taken && pht[train_index] != 0) pht[train_index] <= pht[train_index] - 1'b1;
            end
        end
    end
endmodule
