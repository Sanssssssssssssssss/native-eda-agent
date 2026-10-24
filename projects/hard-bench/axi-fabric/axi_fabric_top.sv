`timescale 1ns/1ps
module axi_fabric_top(
input wire  clk,
input wire  rst,
input wire [3*4-1:0] s_axi_awid,
input wire [3*16-1:0] s_axi_awaddr,
input wire [3*8-1:0] s_axi_awlen,
input wire [3*3-1:0] s_axi_awsize,
input wire [3*2-1:0] s_axi_awburst,
input wire [3-1:0] s_axi_awlock,
input wire [3*4-1:0] s_axi_awcache,
input wire [3*3-1:0] s_axi_awprot,
input wire [3*4-1:0] s_axi_awqos,
input wire [3*1-1:0] s_axi_awuser,
input wire [3-1:0] s_axi_awvalid,
output wire [3-1:0] s_axi_awready,
input wire [3*32-1:0] s_axi_wdata,
input wire [3*4-1:0] s_axi_wstrb,
input wire [3-1:0] s_axi_wlast,
input wire [3*1-1:0] s_axi_wuser,
input wire [3-1:0] s_axi_wvalid,
output wire [3-1:0] s_axi_wready,
output wire [3*4-1:0] s_axi_bid,
output wire [3*2-1:0] s_axi_bresp,
output wire [3*1-1:0] s_axi_buser,
output wire [3-1:0] s_axi_bvalid,
input wire [3-1:0] s_axi_bready,
input wire [3*4-1:0] s_axi_arid,
input wire [3*16-1:0] s_axi_araddr,
input wire [3*8-1:0] s_axi_arlen,
input wire [3*3-1:0] s_axi_arsize,
input wire [3*2-1:0] s_axi_arburst,
input wire [3-1:0] s_axi_arlock,
input wire [3*4-1:0] s_axi_arcache,
input wire [3*3-1:0] s_axi_arprot,
input wire [3*4-1:0] s_axi_arqos,
input wire [3*1-1:0] s_axi_aruser,
input wire [3-1:0] s_axi_arvalid,
output wire [3-1:0] s_axi_arready,
output wire [3*4-1:0] s_axi_rid,
output wire [3*32-1:0] s_axi_rdata,
output wire [3*2-1:0] s_axi_rresp,
output wire [3-1:0] s_axi_rlast,
output wire [3*1-1:0] s_axi_ruser,
output wire [3-1:0] s_axi_rvalid,
input wire [3-1:0] s_axi_rready,
input wire[14:0] release_mask
);
wire [3*6-1:0] m_axi_awid;
wire [3*16-1:0] m_axi_awaddr;
wire [3*8-1:0] m_axi_awlen;
wire [3*3-1:0] m_axi_awsize;
wire [3*2-1:0] m_axi_awburst;
wire [3-1:0] m_axi_awlock;
wire [3*4-1:0] m_axi_awcache;
wire [3*3-1:0] m_axi_awprot;
wire [3*4-1:0] m_axi_awqos;
wire [3*4-1:0] m_axi_awregion;
wire [3*1-1:0] m_axi_awuser;
wire [3-1:0] m_axi_awvalid;
wire [3-1:0] m_axi_awready;
wire [3*32-1:0] m_axi_wdata;
wire [3*4-1:0] m_axi_wstrb;
wire [3-1:0] m_axi_wlast;
wire [3*1-1:0] m_axi_wuser;
wire [3-1:0] m_axi_wvalid;
wire [3-1:0] m_axi_wready;
wire [3*6-1:0] m_axi_bid;
wire [3*2-1:0] m_axi_bresp;
wire [3*1-1:0] m_axi_buser;
wire [3-1:0] m_axi_bvalid;
wire [3-1:0] m_axi_bready;
wire [3*6-1:0] m_axi_arid;
wire [3*16-1:0] m_axi_araddr;
wire [3*8-1:0] m_axi_arlen;
wire [3*3-1:0] m_axi_arsize;
wire [3*2-1:0] m_axi_arburst;
wire [3-1:0] m_axi_arlock;
wire [3*4-1:0] m_axi_arcache;
wire [3*3-1:0] m_axi_arprot;
wire [3*4-1:0] m_axi_arqos;
wire [3*4-1:0] m_axi_arregion;
wire [3*1-1:0] m_axi_aruser;
wire [3-1:0] m_axi_arvalid;
wire [3-1:0] m_axi_arready;
wire [3*6-1:0] m_axi_rid;
wire [3*32-1:0] m_axi_rdata;
wire [3*2-1:0] m_axi_rresp;
wire [3-1:0] m_axi_rlast;
wire [3*1-1:0] m_axi_ruser;
wire [3-1:0] m_axi_rvalid;
wire [3-1:0] m_axi_rready;
wire[2:0] guard_awvalid,guard_awready,core_bvalid,core_bready,core_buser,core_wvalid,core_wready,write_data_allowed;wire[11:0] core_bid;wire[5:0] core_bresp;
assign core_wvalid=s_axi_wvalid & write_data_allowed;assign s_axi_wready=core_wready & write_data_allowed;
assign s_axi_bid=core_bid;assign s_axi_bresp=core_bresp;assign s_axi_buser=core_buser;
genvar guard_index;generate for(guard_index=0;guard_index<3;guard_index=guard_index+1)begin:completion_guards
axi_write_completion_guard guard(.clk(clk),.rst(rst),.awid(s_axi_awid[guard_index*4+:4]),
 .s_awvalid(s_axi_awvalid[guard_index]),.s_awready(s_axi_awready[guard_index]),
 .m_awvalid(guard_awvalid[guard_index]),.m_awready(guard_awready[guard_index]),
 .write_data_allowed(write_data_allowed[guard_index]),
 .wlast_fire(s_axi_wvalid[guard_index]&&s_axi_wready[guard_index]&&s_axi_wlast[guard_index]),
 .bid(core_bid[guard_index*4+:4]),.s_bvalid(core_bvalid[guard_index]),.s_bready(core_bready[guard_index]),
 .m_bvalid(s_axi_bvalid[guard_index]),.m_bready(s_axi_bready[guard_index]));
end endgenerate
axi_crossbar #(
.S_COUNT(3),
.M_COUNT(3),
.DATA_WIDTH(32),
.ADDR_WIDTH(16),
.STRB_WIDTH(4),
.S_ID_WIDTH(4),
.M_ID_WIDTH(6),
.AWUSER_WIDTH(1),
.WUSER_WIDTH(1),
.BUSER_WIDTH(1),
.ARUSER_WIDTH(1),
.RUSER_WIDTH(1),
.S_THREADS({3{32'd4}}),
.S_ACCEPT({3{32'd8}}),
.M_ISSUE({3{32'd8}}),
.M_BASE_ADDR({16'h8000,16'h4000,16'h0000}),
.M_ADDR_WIDTH({3{32'd14}})) fabric(
.clk(clk),
.rst(rst),
.s_axi_awid(s_axi_awid),
.s_axi_awaddr(s_axi_awaddr),
.s_axi_awlen(s_axi_awlen),
.s_axi_awsize(s_axi_awsize),
.s_axi_awburst(s_axi_awburst),
.s_axi_awlock(s_axi_awlock),
.s_axi_awcache(s_axi_awcache),
.s_axi_awprot(s_axi_awprot),
.s_axi_awqos(s_axi_awqos),
.s_axi_awuser(s_axi_awuser),
.s_axi_awvalid(guard_awvalid),
.s_axi_awready(guard_awready),
.s_axi_wdata(s_axi_wdata),
.s_axi_wstrb(s_axi_wstrb),
.s_axi_wlast(s_axi_wlast),
.s_axi_wuser(s_axi_wuser),
.s_axi_wvalid(core_wvalid),
.s_axi_wready(core_wready),
.s_axi_bid(core_bid),
.s_axi_bresp(core_bresp),
.s_axi_buser(core_buser),
.s_axi_bvalid(core_bvalid),
.s_axi_bready(core_bready),
.s_axi_arid(s_axi_arid),
.s_axi_araddr(s_axi_araddr),
.s_axi_arlen(s_axi_arlen),
.s_axi_arsize(s_axi_arsize),
.s_axi_arburst(s_axi_arburst),
.s_axi_arlock(s_axi_arlock),
.s_axi_arcache(s_axi_arcache),
.s_axi_arprot(s_axi_arprot),
.s_axi_arqos(s_axi_arqos),
.s_axi_aruser(s_axi_aruser),
.s_axi_arvalid(s_axi_arvalid),
.s_axi_arready(s_axi_arready),
.s_axi_rid(s_axi_rid),
.s_axi_rdata(s_axi_rdata),
.s_axi_rresp(s_axi_rresp),
.s_axi_rlast(s_axi_rlast),
.s_axi_ruser(s_axi_ruser),
.s_axi_rvalid(s_axi_rvalid),
.s_axi_rready(s_axi_rready),
.m_axi_awid(m_axi_awid),
.m_axi_awaddr(m_axi_awaddr),
.m_axi_awlen(m_axi_awlen),
.m_axi_awsize(m_axi_awsize),
.m_axi_awburst(m_axi_awburst),
.m_axi_awlock(m_axi_awlock),
.m_axi_awcache(m_axi_awcache),
.m_axi_awprot(m_axi_awprot),
.m_axi_awqos(m_axi_awqos),
.m_axi_awregion(m_axi_awregion),
.m_axi_awuser(m_axi_awuser),
.m_axi_awvalid(m_axi_awvalid),
.m_axi_awready(m_axi_awready),
.m_axi_wdata(m_axi_wdata),
.m_axi_wstrb(m_axi_wstrb),
.m_axi_wlast(m_axi_wlast),
.m_axi_wuser(m_axi_wuser),
.m_axi_wvalid(m_axi_wvalid),
.m_axi_wready(m_axi_wready),
.m_axi_bid(m_axi_bid),
.m_axi_bresp(m_axi_bresp),
.m_axi_buser(m_axi_buser),
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
.m_axi_arqos(m_axi_arqos),
.m_axi_arregion(m_axi_arregion),
.m_axi_aruser(m_axi_aruser),
.m_axi_arvalid(m_axi_arvalid),
.m_axi_arready(m_axi_arready),
.m_axi_rid(m_axi_rid),
.m_axi_rdata(m_axi_rdata),
.m_axi_rresp(m_axi_rresp),
.m_axi_rlast(m_axi_rlast),
.m_axi_ruser(m_axi_ruser),
.m_axi_rvalid(m_axi_rvalid),
.m_axi_rready(m_axi_rready));
genvar g;generate for(g=0;g<3;g=g+1)begin:targets
wire [6-1:0] t_awid;
wire [14-1:0] t_awaddr;
wire [7:0] t_awlen;
wire [2:0] t_awsize;
wire [1:0] t_awburst;
wire  t_awlock;
wire [3:0] t_awcache;
wire [2:0] t_awprot;
wire  t_awvalid;
wire  t_awready;
wire [32-1:0] t_wdata;
wire [4-1:0] t_wstrb;
wire  t_wlast;
wire  t_wvalid;
wire  t_wready;
wire [6-1:0] t_bid;
wire [1:0] t_bresp;
wire  t_bvalid;
wire  t_bready;
wire [6-1:0] t_arid;
wire [14-1:0] t_araddr;
wire [7:0] t_arlen;
wire [2:0] t_arsize;
wire [1:0] t_arburst;
wire  t_arlock;
wire [3:0] t_arcache;
wire [2:0] t_arprot;
wire  t_arvalid;
wire  t_arready;
wire [6-1:0] t_rid;
wire [32-1:0] t_rdata;
wire [1:0] t_rresp;
wire  t_rlast;
wire  t_rvalid;
wire  t_rready;
wire[15:0] t_awaddr_full;assign t_awaddr=t_awaddr_full[13:0];
rv_delay #(.WIDTH(43)) delay_aw(.clk(clk),.rst(rst),.permit(release_mask[g*5+0]),.s_data({m_axi_awid[g*6+:6],m_axi_awaddr[g*16+:16],m_axi_awlen[g*8+:8],m_axi_awsize[g*3+:3],m_axi_awburst[g*2+:2],m_axi_awlock[g*1+:1],m_axi_awcache[g*4+:4],m_axi_awprot[g*3+:3]}),.s_valid(m_axi_awvalid[g]),.s_ready(m_axi_awready[g]),.m_data({t_awid,t_awaddr_full,t_awlen,t_awsize,t_awburst,t_awlock,t_awcache,t_awprot}),.m_valid(t_awvalid),.m_ready(t_awready));
rv_delay #(.WIDTH(37)) delay_w(.clk(clk),.rst(rst),.permit(release_mask[g*5+1]),.s_data({m_axi_wdata[g*32+:32],m_axi_wstrb[g*4+:4],m_axi_wlast[g*1+:1]}),.s_valid(m_axi_wvalid[g]),.s_ready(m_axi_wready[g]),.m_data({t_wdata,t_wstrb,t_wlast}),.m_valid(t_wvalid),.m_ready(t_wready));
rv_delay #(.WIDTH(8)) delay_b(.clk(clk),.rst(rst),.permit(release_mask[g*5+2]),.s_data({t_bid,t_bresp}),.s_valid(t_bvalid),.s_ready(t_bready),.m_data({m_axi_bid[g*6+:6],m_axi_bresp[g*2+:2]}),.m_valid(m_axi_bvalid[g]),.m_ready(m_axi_bready[g]));
wire[15:0] t_araddr_full;assign t_araddr=t_araddr_full[13:0];
rv_delay #(.WIDTH(43)) delay_ar(.clk(clk),.rst(rst),.permit(release_mask[g*5+3]),.s_data({m_axi_arid[g*6+:6],m_axi_araddr[g*16+:16],m_axi_arlen[g*8+:8],m_axi_arsize[g*3+:3],m_axi_arburst[g*2+:2],m_axi_arlock[g*1+:1],m_axi_arcache[g*4+:4],m_axi_arprot[g*3+:3]}),.s_valid(m_axi_arvalid[g]),.s_ready(m_axi_arready[g]),.m_data({t_arid,t_araddr_full,t_arlen,t_arsize,t_arburst,t_arlock,t_arcache,t_arprot}),.m_valid(t_arvalid),.m_ready(t_arready));
rv_delay #(.WIDTH(41)) delay_r(.clk(clk),.rst(rst),.permit(release_mask[g*5+4]),.s_data({t_rid,t_rdata,t_rresp,t_rlast}),.s_valid(t_rvalid),.s_ready(t_rready),.m_data({m_axi_rid[g*6+:6],m_axi_rdata[g*32+:32],m_axi_rresp[g*2+:2],m_axi_rlast[g*1+:1]}),.m_valid(m_axi_rvalid[g]),.m_ready(m_axi_rready[g]));
assign m_axi_buser[g]=0;assign m_axi_ruser[g]=0;
if(g<2)begin:ram
axi_ram #(.DATA_WIDTH(32),.ADDR_WIDTH(14),.STRB_WIDTH(4),.ID_WIDTH(6),.PIPELINE_OUTPUT(1)) target(
.clk(clk),
.rst(rst),
.s_axi_awid(t_awid),
.s_axi_awaddr(t_awaddr),
.s_axi_awlen(t_awlen),
.s_axi_awsize(t_awsize),
.s_axi_awburst(t_awburst),
.s_axi_awlock(t_awlock),
.s_axi_awcache(t_awcache),
.s_axi_awprot(t_awprot),
.s_axi_awvalid(t_awvalid),
.s_axi_awready(t_awready),
.s_axi_wdata(t_wdata),
.s_axi_wstrb(t_wstrb),
.s_axi_wlast(t_wlast),
.s_axi_wvalid(t_wvalid),
.s_axi_wready(t_wready),
.s_axi_bid(t_bid),
.s_axi_bresp(t_bresp),
.s_axi_bvalid(t_bvalid),
.s_axi_bready(t_bready),
.s_axi_arid(t_arid),
.s_axi_araddr(t_araddr),
.s_axi_arlen(t_arlen),
.s_axi_arsize(t_arsize),
.s_axi_arburst(t_arburst),
.s_axi_arlock(t_arlock),
.s_axi_arcache(t_arcache),
.s_axi_arprot(t_arprot),
.s_axi_arvalid(t_arvalid),
.s_axi_arready(t_arready),
.s_axi_rid(t_rid),
.s_axi_rdata(t_rdata),
.s_axi_rresp(t_rresp),
.s_axi_rlast(t_rlast),
.s_axi_rvalid(t_rvalid),
.s_axi_rready(t_rready));
end else begin:error_target
axi_error_target #(.DATA_WIDTH(32),.ADDR_WIDTH(14),.STRB_WIDTH(4),.ID_WIDTH(6)) target(
.clk(clk),
.rst(rst),
.s_axi_awid(t_awid),
.s_axi_awaddr(t_awaddr),
.s_axi_awlen(t_awlen),
.s_axi_awsize(t_awsize),
.s_axi_awburst(t_awburst),
.s_axi_awlock(t_awlock),
.s_axi_awcache(t_awcache),
.s_axi_awprot(t_awprot),
.s_axi_awvalid(t_awvalid),
.s_axi_awready(t_awready),
.s_axi_wdata(t_wdata),
.s_axi_wstrb(t_wstrb),
.s_axi_wlast(t_wlast),
.s_axi_wvalid(t_wvalid),
.s_axi_wready(t_wready),
.s_axi_bid(t_bid),
.s_axi_bresp(t_bresp),
.s_axi_bvalid(t_bvalid),
.s_axi_bready(t_bready),
.s_axi_arid(t_arid),
.s_axi_araddr(t_araddr),
.s_axi_arlen(t_arlen),
.s_axi_arsize(t_arsize),
.s_axi_arburst(t_arburst),
.s_axi_arlock(t_arlock),
.s_axi_arcache(t_arcache),
.s_axi_arprot(t_arprot),
.s_axi_arvalid(t_arvalid),
.s_axi_arready(t_arready),
.s_axi_rid(t_rid),
.s_axi_rdata(t_rdata),
.s_axi_rresp(t_rresp),
.s_axi_rlast(t_rlast),
.s_axi_rvalid(t_rvalid),
.s_axi_rready(t_rready));
end
end endgenerate
endmodule
