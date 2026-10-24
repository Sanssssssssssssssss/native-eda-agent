`timescale 1ps/1ps
module TopModule(input clk,reset,in, output done);
localparam IDLE=0, DATA=1, STOP=2, DONE=3, ERROR=4;
reg [2:0] state;
reg [2:0] count;
assign done = state == DONE;
always @(posedge clk) begin
    if (reset) begin state <= IDLE; count <= 0; end
    else case(state)
        IDLE, DONE: if (!in) begin state <= DATA; count <= 0; end else state <= IDLE;
        DATA: if (count == 7) state <= STOP; else count <= count+1'b1;
        STOP: if (in) state <= DONE; else state <= ERROR;
        ERROR: if (in) state <= IDLE;
        default: state <= IDLE;
    endcase
end
endmodule
