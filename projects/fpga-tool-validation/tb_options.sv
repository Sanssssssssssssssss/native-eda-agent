`timescale 1ns/1ps
`include "options.svh"
module tb_fpga_options #(parameter CYCLES=8);
  integer seed, count, inject;
  reg a=0, b=0;
  wire y;
  xor_vhdl dut(.a(a), .b(b), .y(y));
  initial begin
    if (`HEADER_VALUE != 7 || `BUILD_VALUE != 37 || CYCLES != 23) $fatal(1, "OPTIONS_WRONG_COMPILE");
    if (!$value$plusargs("SEED=%d", seed) || seed != 17) $fatal(1, "OPTIONS_WRONG_PLUSARG");
    inject=0;
    if ($value$plusargs("INJECT=%d", inject) && inject) $fatal(1, "OPTIONS_EXPECTED_NEGATIVE");
    for (count=0; count<CYCLES; count=count+1) begin
      a=count & 1; b=(count >> 1) & 1;
      #2;
      if (y !== (a^b)) $fatal(1, "OPTIONS_MIXED_LANGUAGE_FAIL");
    end
    $display("FPGA_OPTIONS_PASS cycles=%0d seed=%0d", count, seed);
    $finish;
  end
  initial begin #1000; $fatal(1,"OPTIONS_TIMEOUT"); end
endmodule
