`timescale 1ps/1ps
module TopModule(input clk, input reset, input w, output z);
    localparam A=0, B=1, C=2, D=3, E=4, F=5;
    reg [2:0] state, next_state;
    always @* begin
        case (state)
            A: next_state = w ? B : A;
            B: next_state = w ? C : D;
            C: next_state = w ? E : D;
            D: next_state = w ? F : A;
            E: next_state = w ? E : D;
            F: next_state = w ? C : D;
            default: next_state = A;
        endcase
    end
    always @(posedge clk)
        if (reset) state <= A;
        else state <= next_state;
    assign z = state == E || state == F;
endmodule
