`timescale 1ns/1ps
module ethernet_cdc_top(
 input wire logic_clk,rx_clk,tx_clk,reset,app_pause,
 input wire[7:0] gmii_rxd,input wire gmii_rx_dv,gmii_rx_er,
 output wire[7:0] gmii_txd,output wire gmii_tx_en,gmii_tx_er,
 output wire logic_rst,rx_rst,tx_rst,
 output wire rx_bad_frame,rx_bad_fcs,rx_overflow,tx_underflow,guard_rejected,ip_bad_checksum,
 output reg[31:0] app_received=0,app_echoed=0
);
sync_reset #(.N(3)) logic_reset_sync(.clk(logic_clk),.rst(reset),.out(logic_rst));
sync_reset #(.N(3)) rx_reset_sync(.clk(rx_clk),.rst(reset),.out(rx_rst));
sync_reset #(.N(3)) tx_reset_sync(.clk(tx_clk),.rst(reset),.out(tx_rst));
wire[7:0] mac_rx_data,mac_tx_data,filtered_data;
wire mac_rx_valid,mac_rx_ready,mac_rx_last,mac_rx_user;
wire mac_tx_valid,mac_tx_ready,mac_tx_last,mac_tx_user;
wire filtered_valid,filtered_ready,filtered_last,filtered_user;
wire checked_user,guard_ready;
eth_mac_1g_fifo #(.TX_FIFO_DEPTH(8192),.RX_FIFO_DEPTH(8192)) mac(
 .rx_clk(rx_clk),.rx_rst(rx_rst),.tx_clk(tx_clk),.tx_rst(tx_rst),.logic_clk(logic_clk),.logic_rst(logic_rst),
 .tx_axis_tdata(mac_tx_data),.tx_axis_tkeep(1'b1),.tx_axis_tvalid(mac_tx_valid),.tx_axis_tready(mac_tx_ready),.tx_axis_tlast(mac_tx_last),.tx_axis_tuser(mac_tx_user),
 .rx_axis_tdata(mac_rx_data),.rx_axis_tvalid(mac_rx_valid),.rx_axis_tready(mac_rx_ready),.rx_axis_tlast(mac_rx_last),.rx_axis_tuser(mac_rx_user),
 .gmii_rxd(gmii_rxd),.gmii_rx_dv(gmii_rx_dv),.gmii_rx_er(gmii_rx_er),.gmii_txd(gmii_txd),.gmii_tx_en(gmii_tx_en),.gmii_tx_er(gmii_tx_er),
 .rx_clk_enable(1'b1),.tx_clk_enable(1'b1),.rx_mii_select(1'b0),.tx_mii_select(1'b0),
 .tx_error_underflow(tx_underflow),.rx_error_bad_frame(rx_bad_frame),.rx_error_bad_fcs(rx_bad_fcs),.rx_fifo_overflow(rx_overflow),
 .cfg_ifg(8'd12),.cfg_tx_enable(1'b1),.cfg_rx_enable(1'b1));
// Upstream IPv4 parser lacks total-length validation. Mark the whole frame bad
// before commit if the IPv4 length is below its header or beyond received bytes.
ipv4_length_guard guard(.clk(logic_clk),.rst(logic_rst),.data(mac_rx_data),.valid(mac_rx_valid),.ready(mac_rx_ready),.last(mac_rx_last),.user(mac_rx_user),.checked_user(checked_user));
axis_fifo #(.DEPTH(2048),.FRAME_FIFO(1),.DROP_BAD_FRAME(1)) validated_frames(
 .clk(logic_clk),.rst(logic_rst),.s_axis_tdata(mac_rx_data),.s_axis_tkeep(1'b1),.s_axis_tvalid(mac_rx_valid),.s_axis_tready(mac_rx_ready),.s_axis_tlast(mac_rx_last),.s_axis_tid(8'd0),.s_axis_tdest(8'd0),.s_axis_tuser(checked_user),
 .m_axis_tdata(filtered_data),.m_axis_tvalid(filtered_valid),.m_axis_tready(filtered_ready),.m_axis_tlast(filtered_last),.m_axis_tuser(filtered_user),.pause_req(1'b0),.status_bad_frame(guard_rejected));
wire  s_eth_hdr_valid;
wire  s_eth_hdr_ready;
wire [47:0] s_eth_dest_mac;
wire [47:0] s_eth_src_mac;
wire [15:0] s_eth_type;
wire [7:0] s_eth_payload_axis_tdata;
wire  s_eth_payload_axis_tvalid;
wire  s_eth_payload_axis_tready;
wire  s_eth_payload_axis_tlast;
wire  s_eth_payload_axis_tuser;
wire  m_eth_hdr_valid;
wire  m_eth_hdr_ready;
wire [47:0] m_eth_dest_mac;
wire [47:0] m_eth_src_mac;
wire [15:0] m_eth_type;
wire [7:0] m_eth_payload_axis_tdata;
wire  m_eth_payload_axis_tvalid;
wire  m_eth_payload_axis_tready;
wire  m_eth_payload_axis_tlast;
wire  m_eth_payload_axis_tuser;
wire  s_ip_hdr_valid;
wire  s_ip_hdr_ready;
wire [5:0] s_ip_dscp;
wire [1:0] s_ip_ecn;
wire [15:0] s_ip_length;
wire [7:0] s_ip_ttl;
wire [7:0] s_ip_protocol;
wire [31:0] s_ip_source_ip;
wire [31:0] s_ip_dest_ip;
wire [7:0] s_ip_payload_axis_tdata;
wire  s_ip_payload_axis_tvalid;
wire  s_ip_payload_axis_tready;
wire  s_ip_payload_axis_tlast;
wire  s_ip_payload_axis_tuser;
wire  m_ip_hdr_valid;
wire  m_ip_hdr_ready;
wire [47:0] m_ip_eth_dest_mac;
wire [47:0] m_ip_eth_src_mac;
wire [15:0] m_ip_eth_type;
wire [3:0] m_ip_version;
wire [3:0] m_ip_ihl;
wire [5:0] m_ip_dscp;
wire [1:0] m_ip_ecn;
wire [15:0] m_ip_length;
wire [15:0] m_ip_identification;
wire [2:0] m_ip_flags;
wire [12:0] m_ip_fragment_offset;
wire [7:0] m_ip_ttl;
wire [7:0] m_ip_protocol;
wire [15:0] m_ip_header_checksum;
wire [31:0] m_ip_source_ip;
wire [31:0] m_ip_dest_ip;
wire [7:0] m_ip_payload_axis_tdata;
wire  m_ip_payload_axis_tvalid;
wire  m_ip_payload_axis_tready;
wire  m_ip_payload_axis_tlast;
wire  m_ip_payload_axis_tuser;
wire  s_udp_hdr_valid;
wire  s_udp_hdr_ready;
wire [5:0] s_udp_ip_dscp;
wire [1:0] s_udp_ip_ecn;
wire [7:0] s_udp_ip_ttl;
wire [31:0] s_udp_ip_source_ip;
wire [31:0] s_udp_ip_dest_ip;
wire [15:0] s_udp_source_port;
wire [15:0] s_udp_dest_port;
wire [15:0] s_udp_length;
wire [15:0] s_udp_checksum;
wire [7:0] s_udp_payload_axis_tdata;
wire  s_udp_payload_axis_tvalid;
wire  s_udp_payload_axis_tready;
wire  s_udp_payload_axis_tlast;
wire  s_udp_payload_axis_tuser;
wire  m_udp_hdr_valid;
wire  m_udp_hdr_ready;
wire [47:0] m_udp_eth_dest_mac;
wire [47:0] m_udp_eth_src_mac;
wire [15:0] m_udp_eth_type;
wire [3:0] m_udp_ip_version;
wire [3:0] m_udp_ip_ihl;
wire [5:0] m_udp_ip_dscp;
wire [1:0] m_udp_ip_ecn;
wire [15:0] m_udp_ip_length;
wire [15:0] m_udp_ip_identification;
wire [2:0] m_udp_ip_flags;
wire [12:0] m_udp_ip_fragment_offset;
wire [7:0] m_udp_ip_ttl;
wire [7:0] m_udp_ip_protocol;
wire [15:0] m_udp_ip_header_checksum;
wire [31:0] m_udp_ip_source_ip;
wire [31:0] m_udp_ip_dest_ip;
wire [15:0] m_udp_source_port;
wire [15:0] m_udp_dest_port;
wire [15:0] m_udp_length;
wire [15:0] m_udp_checksum;
wire [7:0] m_udp_payload_axis_tdata;
wire  m_udp_payload_axis_tvalid;
wire  m_udp_payload_axis_tready;
wire  m_udp_payload_axis_tlast;
wire  m_udp_payload_axis_tuser;
wire  ip_rx_busy;
wire  ip_tx_busy;
wire  udp_rx_busy;
wire  udp_tx_busy;
wire  ip_rx_error_header_early_termination;
wire  ip_rx_error_payload_early_termination;
wire  ip_rx_error_invalid_header;
wire  ip_rx_error_invalid_checksum;
wire  ip_tx_error_payload_early_termination;
wire  ip_tx_error_arp_failed;
wire  udp_rx_error_header_early_termination;
wire  udp_rx_error_payload_early_termination;
wire  udp_tx_error_payload_early_termination;
wire [47:0] local_mac;
wire [31:0] local_ip;
wire [31:0] gateway_ip;
wire [31:0] subnet_mask;
wire  clear_arp_cache;
eth_axis_rx ethernet_decoder(.clk(logic_clk),.rst(logic_rst),
 .s_axis_tdata(filtered_data),.s_axis_tkeep(1'b1),.s_axis_tvalid(filtered_valid),.s_axis_tready(filtered_ready),.s_axis_tlast(filtered_last),.s_axis_tuser(filtered_user),
 .m_eth_hdr_valid(s_eth_hdr_valid),.m_eth_hdr_ready(s_eth_hdr_ready),.m_eth_dest_mac(s_eth_dest_mac),.m_eth_src_mac(s_eth_src_mac),.m_eth_type(s_eth_type),
 .m_eth_payload_axis_tdata(s_eth_payload_axis_tdata),.m_eth_payload_axis_tvalid(s_eth_payload_axis_tvalid),.m_eth_payload_axis_tready(s_eth_payload_axis_tready),.m_eth_payload_axis_tlast(s_eth_payload_axis_tlast),.m_eth_payload_axis_tuser(s_eth_payload_axis_tuser));
eth_axis_tx ethernet_encoder(.clk(logic_clk),.rst(logic_rst),
 .s_eth_hdr_valid(m_eth_hdr_valid),.s_eth_hdr_ready(m_eth_hdr_ready),.s_eth_dest_mac(m_eth_dest_mac),.s_eth_src_mac(m_eth_src_mac),.s_eth_type(m_eth_type),
 .s_eth_payload_axis_tdata(m_eth_payload_axis_tdata),.s_eth_payload_axis_tkeep(1'b1),.s_eth_payload_axis_tvalid(m_eth_payload_axis_tvalid),.s_eth_payload_axis_tready(m_eth_payload_axis_tready),.s_eth_payload_axis_tlast(m_eth_payload_axis_tlast),.s_eth_payload_axis_tuser(m_eth_payload_axis_tuser),
 .m_axis_tdata(mac_tx_data),.m_axis_tvalid(mac_tx_valid),.m_axis_tready(mac_tx_ready),.m_axis_tlast(mac_tx_last),.m_axis_tuser(mac_tx_user));
assign s_ip_hdr_valid=0;
assign s_ip_dscp=0;
assign s_ip_ecn=0;
assign s_ip_length=0;
assign s_ip_ttl=0;
assign s_ip_protocol=0;
assign s_ip_source_ip=0;
assign s_ip_dest_ip=0;
assign s_ip_payload_axis_tdata=0;
assign s_ip_payload_axis_tvalid=0;
assign s_ip_payload_axis_tlast=0;
assign s_ip_payload_axis_tuser=0;
assign m_ip_hdr_ready=1'b1;assign m_ip_payload_axis_tready=1'b1;
assign local_mac=48'h020000000001;assign local_ip=32'hc0a8010a;assign gateway_ip=32'hc0a80101;assign subnet_mask=32'hffffff00;assign clear_arp_cache=0;
assign s_udp_hdr_valid=m_udp_hdr_valid;assign m_udp_hdr_ready=s_udp_hdr_ready;
assign s_udp_ip_dscp=0;assign s_udp_ip_ecn=0;assign s_udp_ip_ttl=64;
assign s_udp_ip_source_ip=local_ip;assign s_udp_ip_dest_ip=m_udp_ip_source_ip;
assign s_udp_source_port=m_udp_dest_port;assign s_udp_dest_port=m_udp_source_port;
assign s_udp_length=m_udp_length;assign s_udp_checksum=0;
axis_fifo #(.DEPTH(2048),.PAUSE_ENABLE(1),.FRAME_PAUSE(1)) echo_payload(
 .clk(logic_clk),.rst(logic_rst),.s_axis_tdata(m_udp_payload_axis_tdata),.s_axis_tkeep(1'b1),.s_axis_tvalid(m_udp_payload_axis_tvalid),.s_axis_tready(m_udp_payload_axis_tready),.s_axis_tlast(m_udp_payload_axis_tlast),.s_axis_tid(8'd0),.s_axis_tdest(8'd0),.s_axis_tuser(m_udp_payload_axis_tuser),
 .m_axis_tdata(s_udp_payload_axis_tdata),.m_axis_tvalid(s_udp_payload_axis_tvalid),.m_axis_tready(s_udp_payload_axis_tready),.m_axis_tlast(s_udp_payload_axis_tlast),.m_axis_tuser(s_udp_payload_axis_tuser),.pause_req(app_pause));
always @(posedge logic_clk)begin
 if(logic_rst)begin app_received<=0;app_echoed<=0;end
 else begin
  if(m_udp_hdr_valid&&m_udp_hdr_ready)app_received<=app_received+1;
  if(s_udp_payload_axis_tvalid&&s_udp_payload_axis_tready&&s_udp_payload_axis_tlast)app_echoed<=app_echoed+1;
 end
end
assign ip_bad_checksum=ip_rx_error_invalid_checksum;
udp_complete #(.ARP_CACHE_ADDR_WIDTH(4),.ARP_REQUEST_RETRY_INTERVAL(20000),.ARP_REQUEST_TIMEOUT(40000)) stack(
.clk(logic_clk),
.rst(logic_rst),
.s_eth_hdr_valid(s_eth_hdr_valid),
.s_eth_hdr_ready(s_eth_hdr_ready),
.s_eth_dest_mac(s_eth_dest_mac),
.s_eth_src_mac(s_eth_src_mac),
.s_eth_type(s_eth_type),
.s_eth_payload_axis_tdata(s_eth_payload_axis_tdata),
.s_eth_payload_axis_tvalid(s_eth_payload_axis_tvalid),
.s_eth_payload_axis_tready(s_eth_payload_axis_tready),
.s_eth_payload_axis_tlast(s_eth_payload_axis_tlast),
.s_eth_payload_axis_tuser(s_eth_payload_axis_tuser),
.m_eth_hdr_valid(m_eth_hdr_valid),
.m_eth_hdr_ready(m_eth_hdr_ready),
.m_eth_dest_mac(m_eth_dest_mac),
.m_eth_src_mac(m_eth_src_mac),
.m_eth_type(m_eth_type),
.m_eth_payload_axis_tdata(m_eth_payload_axis_tdata),
.m_eth_payload_axis_tvalid(m_eth_payload_axis_tvalid),
.m_eth_payload_axis_tready(m_eth_payload_axis_tready),
.m_eth_payload_axis_tlast(m_eth_payload_axis_tlast),
.m_eth_payload_axis_tuser(m_eth_payload_axis_tuser),
.s_ip_hdr_valid(s_ip_hdr_valid),
.s_ip_hdr_ready(s_ip_hdr_ready),
.s_ip_dscp(s_ip_dscp),
.s_ip_ecn(s_ip_ecn),
.s_ip_length(s_ip_length),
.s_ip_ttl(s_ip_ttl),
.s_ip_protocol(s_ip_protocol),
.s_ip_source_ip(s_ip_source_ip),
.s_ip_dest_ip(s_ip_dest_ip),
.s_ip_payload_axis_tdata(s_ip_payload_axis_tdata),
.s_ip_payload_axis_tvalid(s_ip_payload_axis_tvalid),
.s_ip_payload_axis_tready(s_ip_payload_axis_tready),
.s_ip_payload_axis_tlast(s_ip_payload_axis_tlast),
.s_ip_payload_axis_tuser(s_ip_payload_axis_tuser),
.m_ip_hdr_valid(m_ip_hdr_valid),
.m_ip_hdr_ready(m_ip_hdr_ready),
.m_ip_eth_dest_mac(m_ip_eth_dest_mac),
.m_ip_eth_src_mac(m_ip_eth_src_mac),
.m_ip_eth_type(m_ip_eth_type),
.m_ip_version(m_ip_version),
.m_ip_ihl(m_ip_ihl),
.m_ip_dscp(m_ip_dscp),
.m_ip_ecn(m_ip_ecn),
.m_ip_length(m_ip_length),
.m_ip_identification(m_ip_identification),
.m_ip_flags(m_ip_flags),
.m_ip_fragment_offset(m_ip_fragment_offset),
.m_ip_ttl(m_ip_ttl),
.m_ip_protocol(m_ip_protocol),
.m_ip_header_checksum(m_ip_header_checksum),
.m_ip_source_ip(m_ip_source_ip),
.m_ip_dest_ip(m_ip_dest_ip),
.m_ip_payload_axis_tdata(m_ip_payload_axis_tdata),
.m_ip_payload_axis_tvalid(m_ip_payload_axis_tvalid),
.m_ip_payload_axis_tready(m_ip_payload_axis_tready),
.m_ip_payload_axis_tlast(m_ip_payload_axis_tlast),
.m_ip_payload_axis_tuser(m_ip_payload_axis_tuser),
.s_udp_hdr_valid(s_udp_hdr_valid),
.s_udp_hdr_ready(s_udp_hdr_ready),
.s_udp_ip_dscp(s_udp_ip_dscp),
.s_udp_ip_ecn(s_udp_ip_ecn),
.s_udp_ip_ttl(s_udp_ip_ttl),
.s_udp_ip_source_ip(s_udp_ip_source_ip),
.s_udp_ip_dest_ip(s_udp_ip_dest_ip),
.s_udp_source_port(s_udp_source_port),
.s_udp_dest_port(s_udp_dest_port),
.s_udp_length(s_udp_length),
.s_udp_checksum(s_udp_checksum),
.s_udp_payload_axis_tdata(s_udp_payload_axis_tdata),
.s_udp_payload_axis_tvalid(s_udp_payload_axis_tvalid),
.s_udp_payload_axis_tready(s_udp_payload_axis_tready),
.s_udp_payload_axis_tlast(s_udp_payload_axis_tlast),
.s_udp_payload_axis_tuser(s_udp_payload_axis_tuser),
.m_udp_hdr_valid(m_udp_hdr_valid),
.m_udp_hdr_ready(m_udp_hdr_ready),
.m_udp_eth_dest_mac(m_udp_eth_dest_mac),
.m_udp_eth_src_mac(m_udp_eth_src_mac),
.m_udp_eth_type(m_udp_eth_type),
.m_udp_ip_version(m_udp_ip_version),
.m_udp_ip_ihl(m_udp_ip_ihl),
.m_udp_ip_dscp(m_udp_ip_dscp),
.m_udp_ip_ecn(m_udp_ip_ecn),
.m_udp_ip_length(m_udp_ip_length),
.m_udp_ip_identification(m_udp_ip_identification),
.m_udp_ip_flags(m_udp_ip_flags),
.m_udp_ip_fragment_offset(m_udp_ip_fragment_offset),
.m_udp_ip_ttl(m_udp_ip_ttl),
.m_udp_ip_protocol(m_udp_ip_protocol),
.m_udp_ip_header_checksum(m_udp_ip_header_checksum),
.m_udp_ip_source_ip(m_udp_ip_source_ip),
.m_udp_ip_dest_ip(m_udp_ip_dest_ip),
.m_udp_source_port(m_udp_source_port),
.m_udp_dest_port(m_udp_dest_port),
.m_udp_length(m_udp_length),
.m_udp_checksum(m_udp_checksum),
.m_udp_payload_axis_tdata(m_udp_payload_axis_tdata),
.m_udp_payload_axis_tvalid(m_udp_payload_axis_tvalid),
.m_udp_payload_axis_tready(m_udp_payload_axis_tready),
.m_udp_payload_axis_tlast(m_udp_payload_axis_tlast),
.m_udp_payload_axis_tuser(m_udp_payload_axis_tuser),
.ip_rx_busy(ip_rx_busy),
.ip_tx_busy(ip_tx_busy),
.udp_rx_busy(udp_rx_busy),
.udp_tx_busy(udp_tx_busy),
.ip_rx_error_header_early_termination(ip_rx_error_header_early_termination),
.ip_rx_error_payload_early_termination(ip_rx_error_payload_early_termination),
.ip_rx_error_invalid_header(ip_rx_error_invalid_header),
.ip_rx_error_invalid_checksum(ip_rx_error_invalid_checksum),
.ip_tx_error_payload_early_termination(ip_tx_error_payload_early_termination),
.ip_tx_error_arp_failed(ip_tx_error_arp_failed),
.udp_rx_error_header_early_termination(udp_rx_error_header_early_termination),
.udp_rx_error_payload_early_termination(udp_rx_error_payload_early_termination),
.udp_tx_error_payload_early_termination(udp_tx_error_payload_early_termination),
.local_mac(local_mac),
.local_ip(local_ip),
.gateway_ip(gateway_ip),
.subnet_mask(subnet_mask),
.clear_arp_cache(clear_arp_cache)
);
endmodule

module ipv4_length_guard(input wire clk,rst,input wire[7:0] data,input wire valid,ready,last,user,output wire checked_user);
reg[15:0] count=0,eth_type=0,ip_length=0;reg[3:0] ihl=0;
wire invalid_length=eth_type==16'h0800 && (ip_length<{10'd0,ihl,2'b0} || ip_length<20 || {1'b0,ip_length}+17'd14>{1'b0,count}+17'd1);
assign checked_user=user || (last&&invalid_length);
always @(posedge clk)begin
 if(rst)begin count<=0;eth_type<=0;ip_length<=0;ihl<=0;end
 else if(valid&&ready)begin
  if(count==12)eth_type[15:8]<=data;
  if(count==13)eth_type[7:0]<=data;
  if(count==14)ihl<=data[3:0];
  if(count==16)ip_length[15:8]<=data;
  if(count==17)ip_length[7:0]<=data;
  if(last)begin count<=0;eth_type<=0;ip_length<=0;ihl<=0;end else count<=count+1;
 end
end
endmodule
