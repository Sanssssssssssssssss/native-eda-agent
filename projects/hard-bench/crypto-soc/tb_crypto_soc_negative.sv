`timescale 1ns/1ps
module tb_crypto_soc_negative;
    tb_crypto_soc #(.INJECT_FAULT(1)) fault_case();
endmodule
