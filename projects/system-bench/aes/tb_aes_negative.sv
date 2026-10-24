`timescale 1ns/1ps
module tb_aes_negative;
    tb_aes #(.CHECKER_CORRUPT(1)) negative_case();
endmodule
