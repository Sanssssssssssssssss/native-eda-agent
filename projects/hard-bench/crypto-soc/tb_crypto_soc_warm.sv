`timescale 1ns/1ps
module tb_crypto_soc_warm;
    tb_crypto_soc #(.WARM_RESET(1),.SEED_COUNT(1)) warm_reset_case();
endmodule
