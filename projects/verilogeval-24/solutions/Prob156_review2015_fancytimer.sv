`timescale 1ps/1ps
module TopModule(input clk, input reset, input data, output reg [3:0] count,
                 output counting, output done, input ack);
    localparam SEARCH=0, ONE=1, TWO=2, TWO_ZERO=3, SHIFT=4, COUNT=5, DONE=6;
    reg [2:0] state;
    reg [1:0] shift_index;
    reg [9:0] ticks;
    always @(posedge clk) begin
        if (reset) begin state <= SEARCH; count <= 0; shift_index <= 0; ticks <= 0; end
        else case (state)
            SEARCH: state <= data ? ONE : SEARCH;
            ONE: state <= data ? TWO : SEARCH;
            TWO: state <= data ? TWO : TWO_ZERO;
            TWO_ZERO: begin
                state <= data ? SHIFT : SEARCH;
                shift_index <= 0;
            end
            SHIFT: begin
                count <= {count[2:0],data};
                shift_index <= shift_index + 1'b1;
                if (shift_index == 3) begin state <= COUNT; ticks <= 0; end
            end
            COUNT: begin
                if (ticks == 999) begin
                    ticks <= 0;
                    if (count == 0) state <= DONE;
                    else count <= count - 1'b1;
                end else ticks <= ticks + 1'b1;
            end
            DONE: if (ack) state <= SEARCH;
            default: state <= SEARCH;
        endcase
    end
    assign counting = state == COUNT;
    assign done = state == DONE;
endmodule
