`timescale 1ns/1ps
module tb_soc;
 reg clk=0;always #5 clk=~clk;
 reg resetn=0;reg [31:0] seed;reg[2:0] stall_mask;
 wire trap,result_valid,done;wire[31:0] result_data,irq_count,bus_transactions;
 soc_top dut(.*);
 reg[31:0] expected[0:39];reg[31:0] seeds[0:7];
 integer test_id,outputs,cycles,total_cycles=0,total_bus=0;
 initial begin
   $readmemh("E:/GPTProject2/EDAAgent/projects/system-bench/soc/expected.hex",expected);
   seeds[0]=1;seeds[1]=32'h12345678;seeds[2]=32'hdeadbeef;seeds[3]=32'hffffffff;
   seeds[4]=0;seeds[5]=32'h80000000;seeds[6]=32'h31415926;seeds[7]=32'habcdef01;
   for(test_id=0;test_id<8;test_id=test_id+1) begin
     resetn=0;seed=seeds[test_id];stall_mask=test_id%4==0?0:(test_id%4==1?1:(test_id%4==2?3:7));
     // Reset the RAM image between independent program runs.
     $readmemh("E:/GPTProject2/EDAAgent/projects/system-bench/soc/firmware.hex",dut.ram);
     outputs=0;cycles=0;repeat(8)@(negedge clk);resetn=1;
     while(!done && cycles<12000000) begin
       @(negedge clk);cycles=cycles+1;
       if(trap)$fatal(1,"CPU_TRAP case=%0d",test_id);
       if(result_valid)begin
         if(outputs<5)begin
           if(result_data!==expected[test_id*5+outputs])$fatal(1,"SOC_MISMATCH case=%0d result=%0d got=%h expected=%h",test_id,outputs,result_data,expected[test_id*5+outputs]);
         end else if(outputs==5)begin
           if(result_data<10 || result_data>cycles/2048+1)$fatal(1,"IRQ_COUNT_INVALID %0d",result_data);
         end else $fatal(1,"EXTRA_OUTPUT");
         outputs=outputs+1;
       end
     end
     if(!done || outputs!=6)$fatal(1,"SOC_TIMEOUT_OR_MISSING_OUTPUT case=%0d outputs=%0d",test_id,outputs);
     $display("SOC_CASE_PASS case=%0d seed=%h stall_mask=%0d cycles=%0d bus_transactions=%0d interrupts=%0d",test_id,seed,stall_mask,cycles,bus_transactions,irq_count);
     total_cycles=total_cycles+cycles;total_bus=total_bus+bus_transactions;
   end
   $display("SYSTEM_BENCH_PASS project=soc scenarios=8 algorithm_checks=40 irq_checks=8 cycles=%0d bus_transactions=%0d",total_cycles,total_bus);
   $finish;
 end
endmodule
