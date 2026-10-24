`timescale 1ps/1ps
module TopModule(input clk, input areset, input bump_left, input bump_right,
                 input ground, input dig, output walk_left, output walk_right,
                 output aaah, output digging);
    localparam WALK=0, FALL=1, DIG=2, DEAD=3;
    reg [1:0] state;
    reg rightward;
    reg [4:0] fall_cycles;
    always @(posedge clk or posedge areset) begin
        if (areset) begin state <= WALK; rightward <= 0; fall_cycles <= 0; end
        else case (state)
            WALK: begin
                fall_cycles <= 0;
                if (!ground) begin state <= FALL; fall_cycles <= 1; end
                else if (dig) state <= DIG;
                else if (rightward ? bump_right : bump_left) rightward <= ~rightward;
            end
            DIG: if (!ground) begin state <= FALL; fall_cycles <= 1; end
            FALL: begin
                if (ground) state <= fall_cycles > 20 ? DEAD : WALK;
                else if (fall_cycles < 21) fall_cycles <= fall_cycles + 1'b1;
            end
            DEAD: state <= DEAD;
            default: state <= WALK;
        endcase
    end
    assign walk_left = state == WALK && !rightward;
    assign walk_right = state == WALK && rightward;
    assign aaah = state == FALL;
    assign digging = state == DIG;
endmodule
