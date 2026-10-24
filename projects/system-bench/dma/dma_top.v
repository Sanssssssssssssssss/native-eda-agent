`timescale 1ns/1ps
module dma_top(
input wire clk,input wire rst,
 input wire req_valid,output wire req_ready,
 input wire [15:0] src_addr,dst_addr,length,input wire[7:0] tag,
 output reg done,output reg[3:0] read_error,write_error,
 output reg[7:0] done_tag,output reg[15:0] done_length,
output wire [4-1:0] m_axi_awid,
output wire [16-1:0] m_axi_awaddr,
output wire [7:0] m_axi_awlen,
output wire [2:0] m_axi_awsize,
output wire [1:0] m_axi_awburst,
output wire  m_axi_awlock,
output wire [3:0] m_axi_awcache,
output wire [2:0] m_axi_awprot,
output wire  m_axi_awvalid,
input wire  m_axi_awready,
output wire [32-1:0] m_axi_wdata,
output wire [4-1:0] m_axi_wstrb,
output wire  m_axi_wlast,
output wire  m_axi_wvalid,
input wire  m_axi_wready,
input wire [4-1:0] m_axi_bid,
input wire [1:0] m_axi_bresp,
input wire  m_axi_bvalid,
output wire  m_axi_bready,
output wire [4-1:0] m_axi_arid,
output wire [16-1:0] m_axi_araddr,
output wire [7:0] m_axi_arlen,
output wire [2:0] m_axi_arsize,
output wire [1:0] m_axi_arburst,
output wire  m_axi_arlock,
output wire [3:0] m_axi_arcache,
output wire [2:0] m_axi_arprot,
output wire  m_axi_arvalid,
input wire  m_axi_arready,
input wire [4-1:0] m_axi_rid,
input wire [32-1:0] m_axi_rdata,
input wire [1:0] m_axi_rresp,
input wire  m_axi_rlast,
input wire  m_axi_rvalid,
output wire  m_axi_rready
);

reg busy,rd_pending,wr_pending,rd_seen,wr_seen;
reg[15:0] src_reg,dst_reg,len_reg;reg[7:0] tag_reg;
wire rd_ready,wr_ready,rd_status,wr_status;wire[3:0] rd_error,wr_error;
wire[7:0] rd_tag,wr_tag;wire[15:0] wr_len;
wire[31:0] in_data,out_data;wire[3:0] in_keep,out_keep;
wire in_valid,in_ready,in_last,out_valid,out_ready,out_last;
assign req_ready=!busy;
always @(posedge clk)begin
 done<=0;
 if(rst)begin busy<=0;rd_pending<=0;wr_pending<=0;rd_seen<=0;wr_seen<=0;
 read_error<=0;write_error<=0;done_tag<=0;done_length<=0;
 src_reg<=0;dst_reg<=0;len_reg<=0;tag_reg<=0;
 end else begin
   if(req_valid&&req_ready)begin
     busy<=1;rd_pending<=1;wr_pending<=1;rd_seen<=0;wr_seen<=0;
     src_reg<=src_addr;dst_reg<=dst_addr;len_reg<=length;tag_reg<=tag;
   end
   if(rd_pending&&rd_ready)rd_pending<=0;
   if(wr_pending&&wr_ready)wr_pending<=0;
   if(rd_status)begin rd_seen<=1;read_error<=rd_error;end
   if(wr_status)begin wr_seen<=1;write_error<=wr_error;done_tag<=wr_tag;done_length<=wr_len;end
   if(busy&&rd_seen&&wr_seen)begin busy<=0;done<=1;end
 end
end
axis_fifo #(.DEPTH(1024),.DATA_WIDTH(32),.KEEP_ENABLE(1),.KEEP_WIDTH(4),
 .ID_ENABLE(0),.DEST_ENABLE(0),.USER_ENABLE(0)) fifo (
 .clk(clk),.rst(rst),.s_axis_tdata(in_data),.s_axis_tkeep(in_keep),
 .s_axis_tvalid(in_valid),.s_axis_tready(in_ready),.s_axis_tlast(in_last),
 .s_axis_tid(8'b0),.s_axis_tdest(8'b0),.s_axis_tuser(1'b0),
 .m_axis_tdata(out_data),.m_axis_tkeep(out_keep),.m_axis_tvalid(out_valid),
 .m_axis_tready(out_ready),.m_axis_tlast(out_last),.pause_req(1'b0));
axi_dma #(
.AXI_DATA_WIDTH(32),
.AXI_ADDR_WIDTH(16),
.AXI_STRB_WIDTH(4),
.AXI_ID_WIDTH(4),
.AXIS_DATA_WIDTH(32),
.AXIS_KEEP_WIDTH(4),
.AXIS_ID_WIDTH(8),
.AXIS_DEST_WIDTH(8),
.AXIS_USER_WIDTH(1),
.LEN_WIDTH(16),
.TAG_WIDTH(8),
.AXI_MAX_BURST_LEN(16),
.ENABLE_UNALIGNED(1),
.AXIS_ID_ENABLE(0),
.AXIS_DEST_ENABLE(0),
.AXIS_USER_ENABLE(0)) dma (
.clk(clk),
.rst(rst),
.s_axis_read_desc_addr(src_reg),
.s_axis_read_desc_len(len_reg),
.s_axis_read_desc_tag(tag_reg),
.s_axis_read_desc_id(8'b0),
.s_axis_read_desc_dest(8'b0),
.s_axis_read_desc_user(1'b0),
.s_axis_read_desc_valid(rd_pending),
.s_axis_read_desc_ready(rd_ready),
.m_axis_read_desc_status_tag(rd_tag),
.m_axis_read_desc_status_error(rd_error),
.m_axis_read_desc_status_valid(rd_status),
.m_axis_read_data_tdata(in_data),
.m_axis_read_data_tkeep(in_keep),
.m_axis_read_data_tvalid(in_valid),
.m_axis_read_data_tready(in_ready),
.m_axis_read_data_tlast(in_last),
.m_axis_read_data_tid(),
.m_axis_read_data_tdest(),
.m_axis_read_data_tuser(),
.s_axis_write_desc_addr(dst_reg),
.s_axis_write_desc_len(len_reg),
.s_axis_write_desc_tag(tag_reg),
.s_axis_write_desc_valid(wr_pending),
.s_axis_write_desc_ready(wr_ready),
.m_axis_write_desc_status_len(wr_len),
.m_axis_write_desc_status_tag(wr_tag),
.m_axis_write_desc_status_id(),
.m_axis_write_desc_status_dest(),
.m_axis_write_desc_status_user(),
.m_axis_write_desc_status_error(wr_error),
.m_axis_write_desc_status_valid(wr_status),
.s_axis_write_data_tdata(out_data),
.s_axis_write_data_tkeep(out_keep),
.s_axis_write_data_tvalid(out_valid),
.s_axis_write_data_tready(out_ready),
.s_axis_write_data_tlast(out_last),
.s_axis_write_data_tid(8'b0),
.s_axis_write_data_tdest(8'b0),
.s_axis_write_data_tuser(1'b0),
.m_axi_awid(m_axi_awid),
.m_axi_awaddr(m_axi_awaddr),
.m_axi_awlen(m_axi_awlen),
.m_axi_awsize(m_axi_awsize),
.m_axi_awburst(m_axi_awburst),
.m_axi_awlock(m_axi_awlock),
.m_axi_awcache(m_axi_awcache),
.m_axi_awprot(m_axi_awprot),
.m_axi_awvalid(m_axi_awvalid),
.m_axi_awready(m_axi_awready),
.m_axi_wdata(m_axi_wdata),
.m_axi_wstrb(m_axi_wstrb),
.m_axi_wlast(m_axi_wlast),
.m_axi_wvalid(m_axi_wvalid),
.m_axi_wready(m_axi_wready),
.m_axi_bid(m_axi_bid),
.m_axi_bresp(m_axi_bresp),
.m_axi_bvalid(m_axi_bvalid),
.m_axi_bready(m_axi_bready),
.m_axi_arid(m_axi_arid),
.m_axi_araddr(m_axi_araddr),
.m_axi_arlen(m_axi_arlen),
.m_axi_arsize(m_axi_arsize),
.m_axi_arburst(m_axi_arburst),
.m_axi_arlock(m_axi_arlock),
.m_axi_arcache(m_axi_arcache),
.m_axi_arprot(m_axi_arprot),
.m_axi_arvalid(m_axi_arvalid),
.m_axi_arready(m_axi_arready),
.m_axi_rid(m_axi_rid),
.m_axi_rdata(m_axi_rdata),
.m_axi_rresp(m_axi_rresp),
.m_axi_rlast(m_axi_rlast),
.m_axi_rvalid(m_axi_rvalid),
.m_axi_rready(m_axi_rready),
.read_enable(1'b1),
.write_enable(1'b1),
.write_abort(1'b0));
endmodule
