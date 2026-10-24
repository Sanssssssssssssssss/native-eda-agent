`timescale 1ns/1ps
module axi_error_target #(parameter DATA_WIDTH=32,ADDR_WIDTH=14,STRB_WIDTH=4,ID_WIDTH=6)(
input wire  clk,
input wire  rst,
input wire [6-1:0] s_axi_awid,
input wire [14-1:0] s_axi_awaddr,
input wire [7:0] s_axi_awlen,
input wire [2:0] s_axi_awsize,
input wire [1:0] s_axi_awburst,
input wire  s_axi_awlock,
input wire [3:0] s_axi_awcache,
input wire [2:0] s_axi_awprot,
input wire  s_axi_awvalid,
output wire  s_axi_awready,
input wire [32-1:0] s_axi_wdata,
input wire [4-1:0] s_axi_wstrb,
input wire  s_axi_wlast,
input wire  s_axi_wvalid,
output wire  s_axi_wready,
output wire [6-1:0] s_axi_bid,
output wire [1:0] s_axi_bresp,
output wire  s_axi_bvalid,
input wire  s_axi_bready,
input wire [6-1:0] s_axi_arid,
input wire [14-1:0] s_axi_araddr,
input wire [7:0] s_axi_arlen,
input wire [2:0] s_axi_arsize,
input wire [1:0] s_axi_arburst,
input wire  s_axi_arlock,
input wire [3:0] s_axi_arcache,
input wire [2:0] s_axi_arprot,
input wire  s_axi_arvalid,
output wire  s_axi_arready,
output wire [6-1:0] s_axi_rid,
output wire [32-1:0] s_axi_rdata,
output wire [1:0] s_axi_rresp,
output wire  s_axi_rlast,
output wire  s_axi_rvalid,
input wire  s_axi_rready
);
reg writing=0,reading=0,bvalid=0;
reg[8:0] wleft=0,rleft=0;reg[5:0] wid=0,rid=0;
assign s_axi_awready=!writing&&!bvalid&&!rst;
assign s_axi_wready=writing&&!rst;
assign s_axi_bid=wid;assign s_axi_bresp=2'b10;assign s_axi_bvalid=bvalid&&!rst;
assign s_axi_arready=!reading&&!rst;
assign s_axi_rid=rid;assign s_axi_rdata=32'hbad0add0;assign s_axi_rresp=2'b10;
assign s_axi_rlast=rleft==1;assign s_axi_rvalid=reading&&!rst;
always @(posedge clk)begin
 if(rst)begin writing<=0;reading<=0;bvalid<=0;wleft<=0;rleft<=0;wid<=0;rid<=0;end
 else begin
  if(s_axi_awvalid&&s_axi_awready)begin writing<=1;wid<=s_axi_awid;wleft<=s_axi_awlen+9'd1;end
  if(s_axi_wvalid&&s_axi_wready)begin
   wleft<=wleft-1'b1;if(wleft==1)begin writing<=0;bvalid<=1;end
  end
  if(s_axi_bvalid&&s_axi_bready)bvalid<=0;
  if(s_axi_arvalid&&s_axi_arready)begin reading<=1;rid<=s_axi_arid;rleft<=s_axi_arlen+9'd1;end
  if(s_axi_rvalid&&s_axi_rready)begin rleft<=rleft-1'b1;if(rleft==1)reading<=0;end
 end
end
endmodule
