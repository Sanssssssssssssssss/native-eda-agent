`timescale 1ps/1ps
module TopModule(input in, input [3:0] state, output [3:0] next_state, output out);
    assign next_state[0] = (state[0] | state[2]) & ~in;
    assign next_state[1] = (state[0] | state[1] | state[3]) & in;
    assign next_state[2] = (state[1] | state[3]) & ~in;
    assign next_state[3] = state[2] & in;
    assign out = state[3];
endmodule
