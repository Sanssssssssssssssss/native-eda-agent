`timescale 1ns/1ps
module tb_counter;
reg clk = 0;
reg rst = 1;
reg en = 0;
wire [7:0] count;
integer expected = 0;
integer checks = 0;
integer wraps = 0;
integer holds = 0;
integer resets = 0;
integer i;
counter dut(.clk(clk), .rst(rst), .en(en), .count(count));
always #5 clk = ~clk;
task automatic tick(input bit reset_value, input bit enable_value);
begin
    @(negedge clk);
    rst = reset_value;
    en = enable_value;
    if (reset_value) begin expected = 0; resets = resets + 1; end
    else if (enable_value) begin
        if (expected == 255) wraps = wraps + 1;
        expected = (expected + 1) % 256;
    end else holds = holds + 1;
    @(posedge clk);
    #1;
    checks = checks + 1;
    if (count !== expected[7:0])
        $fatal(1, "COUNTER_FAIL check=%0d expected=%0d actual=%0d", checks, expected, count);
end
endtask
initial begin
    tick(1, 0);
    for (i=0; i<300; i=i+1) tick(0, 1);
    repeat (7) tick(0, 0);
    tick(1, 1);
    repeat (11) tick(0, 1);
    tick(1, 0);
    if (wraps != 1 || holds != 7 || resets != 3 || checks != 321)
        $fatal(1, "COUNTER_TEST_INCOMPLETE");
    $display("COUNTER_PASS checks=%0d wraps=%0d holds=%0d resets=%0d", checks, wraps, holds, resets);
    $finish;
end
initial begin
    #10000;
    $fatal(1, "COUNTER_TIMEOUT");
end
endmodule
