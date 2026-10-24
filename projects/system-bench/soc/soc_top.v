`timescale 1ns/1ps
module soc_top #(
 parameter FIRMWARE = "E:/GPTProject2/EDAAgent/projects/system-bench/soc/firmware.hex"
)(input wire clk, input wire resetn, input wire [31:0] seed,
 input wire [2:0] stall_mask, output wire trap,
 output reg result_valid, output reg [31:0] result_data,
 output reg done, output reg [31:0] irq_count,
 output reg [31:0] bus_transactions);
 wire valid,instr; wire [31:0] addr,wdata; wire [3:0] wstrb;
 reg ready=0; wire [31:0] rdata;
 reg [31:0] ram_data,io_data; reg select_io;
 (* ram_style="block" *) reg [31:0] ram [0:16383];
 reg [31:0] cycles;
 reg [15:0] rng;
 integer j;
 initial $readmemh(FIRMWARE,ram);
 assign rdata=select_io?io_data:ram_data;
 wire irq_pulse=cycles[10:0]==11'h7ff;
 picorv32 #(.ENABLE_MUL(1),.ENABLE_DIV(1),.BARREL_SHIFTER(1),
 .ENABLE_IRQ(1),.ENABLE_IRQ_TIMER(0),.STACKADDR(32'h10000)) cpu (
 .clk(clk),.resetn(resetn),.trap(trap),.mem_valid(valid),.mem_instr(instr),
 .mem_ready(ready),.mem_addr(addr),.mem_wdata(wdata),.mem_wstrb(wstrb),.mem_rdata(rdata),
 .pcpi_wr(1'b0),.pcpi_rd(32'b0),.pcpi_wait(1'b0),.pcpi_ready(1'b0),
 .irq({27'b0,irq_pulse,4'b0}));
 // Synchronous RAM with byte enables; CPU request remains stable until ready.
 always @(posedge clk) begin
   if(valid&&!ready && ((rng[2:0]&stall_mask)==0) && addr[31:16]==0) begin
     ram_data<=ram[addr[15:2]];
     for(j=0;j<4;j=j+1)if(wstrb[j])ram[addr[15:2]][8*j+:8]<=wdata[8*j+:8];
   end
 end
 always @(posedge clk) begin
   result_valid<=0;
   if(!resetn) begin
     ready<=0;done<=0;irq_count<=0;bus_transactions<=0;cycles<=0;rng<=16'hbeef;
     result_data<=0;io_data<=0;select_io<=0;
   end else begin
     cycles<=cycles+1;
     rng<={rng[14:0],rng[15]^rng[13]^rng[12]^rng[10]};
     ready<=0;
     if(valid&&!ready && ((rng[2:0]&stall_mask)==0)) begin
       ready<=1;bus_transactions<=bus_transactions+1;select_io<=addr[31:16]!=0;
       io_data<=0;
       if(addr==32'h10000000)io_data<=seed;
       if(addr==32'h10000010) begin
         io_data<=irq_count;
         if(|wstrb)irq_count<=irq_count+1;
       end
       if(addr==32'h10000004&&|wstrb)begin result_valid<=1;result_data<=wdata;end
       if(addr==32'h10000008&&|wstrb)done<=wdata==32'h600dcafe;
     end
   end
 end
endmodule
