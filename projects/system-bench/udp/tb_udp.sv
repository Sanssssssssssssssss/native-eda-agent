`timescale 1ns/1ps
module tb_udp;
reg  clk=0;
reg  rst=0;
reg  s_eth_hdr_valid=0;
wire  s_eth_hdr_ready;
reg [47:0] s_eth_dest_mac=0;
reg [47:0] s_eth_src_mac=0;
reg [15:0] s_eth_type=0;
reg [7:0] s_eth_payload_axis_tdata=0;
reg  s_eth_payload_axis_tvalid=0;
wire  s_eth_payload_axis_tready;
reg  s_eth_payload_axis_tlast=0;
reg  s_eth_payload_axis_tuser=0;
wire  m_eth_hdr_valid;
reg  m_eth_hdr_ready=0;
wire [47:0] m_eth_dest_mac;
wire [47:0] m_eth_src_mac;
wire [15:0] m_eth_type;
wire [7:0] m_eth_payload_axis_tdata;
wire  m_eth_payload_axis_tvalid;
reg  m_eth_payload_axis_tready=0;
wire  m_eth_payload_axis_tlast;
wire  m_eth_payload_axis_tuser;
reg  s_ip_hdr_valid=0;
wire  s_ip_hdr_ready;
reg [5:0] s_ip_dscp=0;
reg [1:0] s_ip_ecn=0;
reg [15:0] s_ip_length=0;
reg [7:0] s_ip_ttl=0;
reg [7:0] s_ip_protocol=0;
reg [31:0] s_ip_source_ip=0;
reg [31:0] s_ip_dest_ip=0;
reg [7:0] s_ip_payload_axis_tdata=0;
reg  s_ip_payload_axis_tvalid=0;
wire  s_ip_payload_axis_tready;
reg  s_ip_payload_axis_tlast=0;
reg  s_ip_payload_axis_tuser=0;
wire  m_ip_hdr_valid;
reg  m_ip_hdr_ready=0;
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
reg  m_ip_payload_axis_tready=0;
wire  m_ip_payload_axis_tlast;
wire  m_ip_payload_axis_tuser;
reg  s_udp_hdr_valid=0;
wire  s_udp_hdr_ready;
reg [5:0] s_udp_ip_dscp=0;
reg [1:0] s_udp_ip_ecn=0;
reg [7:0] s_udp_ip_ttl=0;
reg [31:0] s_udp_ip_source_ip=0;
reg [31:0] s_udp_ip_dest_ip=0;
reg [15:0] s_udp_source_port=0;
reg [15:0] s_udp_dest_port=0;
reg [15:0] s_udp_length=0;
reg [15:0] s_udp_checksum=0;
reg [7:0] s_udp_payload_axis_tdata=0;
reg  s_udp_payload_axis_tvalid=0;
wire  s_udp_payload_axis_tready;
reg  s_udp_payload_axis_tlast=0;
reg  s_udp_payload_axis_tuser=0;
wire  m_udp_hdr_valid;
reg  m_udp_hdr_ready=0;
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
reg  m_udp_payload_axis_tready=0;
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
reg [47:0] local_mac=0;
reg [31:0] local_ip=0;
reg [31:0] gateway_ip=0;
reg [31:0] subnet_mask=0;
reg  clear_arp_cache=0;
always #5 clk=~clk;
udp_top dut(.*);
localparam N=64;
integer lengths[0:N-1];
reg [7:0] tx_expected[0:32926],rx_vectors[0:32926],payload[0:31134],arp_vectors[0:55],bad_vectors[0:59];
integer cycles=0,tx_packets=0,rx_packets=0,arp_packets=0,ip_headers=0,udp_headers=0;
integer tx_offset=0,rx_offset=0,tx_position=0,rx_position=0;
integer invalid_checksums=0,short_headers=0,arp_errors=0;
integer current_case=0,i,j,before_arp,before_errors,rx_start;
integer base_tx=0,base_rx=0,base_bytes=0;
reg [15:0] active_eth_type=0; reg [7:0] arp_bytes[0:63];integer arp_pos=0;
reg [31:0] random_state=32'h19f73a51;
reg eth_pending=0,udp_pending=0,eth_frame_active=0,udp_frame_active=0;reg[9:0] held_eth;reg[9:0] held_udp;
always @(negedge clk) begin
 random_state={random_state[30:0],random_state[31]^random_state[21]^random_state[1]^random_state[0]};
 m_eth_hdr_ready=!rst && !eth_frame_active && random_state[0];
 m_eth_payload_axis_tready=!rst && eth_frame_active && (random_state[1]||random_state[2]);
 m_udp_hdr_ready=!rst && !udp_frame_active && random_state[3];
 m_udp_payload_axis_tready=!rst && udp_frame_active && (random_state[4]||random_state[5]);
 m_ip_hdr_ready=1;m_ip_payload_axis_tready=1;
end
always @(posedge clk) begin
 cycles=cycles+1;
 if(cycles>2000000)$fatal(1,"TIMEOUT udp");
 if(rst)begin eth_pending=0;udp_pending=0;eth_frame_active=0;udp_frame_active=0;active_eth_type=0;end
 else begin
  if(eth_pending && {m_eth_payload_axis_tuser,m_eth_payload_axis_tlast,m_eth_payload_axis_tdata}!==held_eth)$fatal(1,"Ethernet AXIS changed during stall");
  if(eth_pending && !m_eth_payload_axis_tvalid)$fatal(1,"Ethernet AXIS valid dropped during stall");
  eth_pending=m_eth_payload_axis_tvalid&&!m_eth_payload_axis_tready;
  held_eth={m_eth_payload_axis_tuser,m_eth_payload_axis_tlast,m_eth_payload_axis_tdata};
  if(udp_pending && {m_udp_payload_axis_tuser,m_udp_payload_axis_tlast,m_udp_payload_axis_tdata}!==held_udp)$fatal(1,"UDP AXIS changed during stall");
  if(udp_pending && !m_udp_payload_axis_tvalid)$fatal(1,"UDP AXIS valid dropped during stall");
  udp_pending=m_udp_payload_axis_tvalid&&!m_udp_payload_axis_tready;
  held_udp={m_udp_payload_axis_tuser,m_udp_payload_axis_tlast,m_udp_payload_axis_tdata};
  if(ip_rx_error_invalid_checksum)invalid_checksums=invalid_checksums+1;
  if(ip_rx_error_header_early_termination)short_headers=short_headers+1;
  if(ip_tx_error_arp_failed)arp_errors=arp_errors+1;
  if(m_eth_hdr_valid && m_eth_hdr_ready)begin
   if(m_eth_src_mac!==48'h020000000001)$fatal(1,"Bad Ethernet source MAC");
   active_eth_type=m_eth_type;eth_frame_active=1;
   if(m_eth_type==16'h0800)begin
    if(m_eth_dest_mac!==48'h020000000002)$fatal(1,"Bad resolved destination MAC");
    ip_headers=ip_headers+1;
   end else if(m_eth_type!=16'h0806)$fatal(1,"Unexpected Ethernet type");
  end
  if(m_eth_payload_axis_tvalid && m_eth_payload_axis_tready)begin
   if(m_eth_payload_axis_tlast)eth_frame_active=0;
   if(m_eth_payload_axis_tuser)$fatal(1,"Unexpected outgoing frame error");
   if(active_eth_type==16'h0800)begin
    if(tx_packets>=N)$fatal(1,"Unexpected extra IP frame");
    if(m_eth_payload_axis_tdata!==tx_expected[tx_offset+tx_position])$fatal(1,"TX mismatch packet=%0d byte=%0d got=%02x expected=%02x",tx_packets,tx_position,m_eth_payload_axis_tdata,tx_expected[tx_offset+tx_position]);
    if(m_eth_payload_axis_tlast !== (tx_position==lengths[tx_packets]+27))$fatal(1,"TX last mismatch");
    tx_position=tx_position+1;
    if(m_eth_payload_axis_tlast)begin tx_offset=tx_offset+tx_position;tx_position=0;tx_packets=tx_packets+1;end
   end else if(active_eth_type==16'h0806)begin
    if(arp_pos>27)$fatal(1,"ARP too long");
    arp_bytes[arp_pos]=m_eth_payload_axis_tdata;arp_pos=arp_pos+1;
    if(m_eth_payload_axis_tlast)begin
     if(arp_pos!=28 || {arp_bytes[0],arp_bytes[1],arp_bytes[2],arp_bytes[3],arp_bytes[4],arp_bytes[5]}!==48'h000108000604)$fatal(1,"Malformed ARP output");
     if({arp_bytes[8],arp_bytes[9],arp_bytes[10],arp_bytes[11],arp_bytes[12],arp_bytes[13]}!==48'h020000000001)$fatal(1,"ARP source MAC");
     if({arp_bytes[14],arp_bytes[15],arp_bytes[16],arp_bytes[17]}!==32'hc0a8010a)$fatal(1,"ARP source IP");
     if(arp_bytes[7]!=1 && arp_bytes[7]!=2)$fatal(1,"ARP opcode");
     arp_packets=arp_packets+1;arp_pos=0;
    end
   end else $fatal(1,"Payload without Ethernet header");
  end
  if(m_udp_hdr_valid&&m_udp_hdr_ready)begin
   udp_frame_active=1;
   if(udp_headers>=N)$fatal(1,"Unexpected UDP header after invalid input");
   if(m_udp_ip_source_ip!==32'hc0a80114 || m_udp_ip_dest_ip!==32'hc0a8010a || m_udp_source_port!==(4000+udp_headers) || m_udp_dest_port!==(5000+udp_headers) || m_udp_length!==(lengths[udp_headers]+8))$fatal(1,"UDP header mismatch packet %0d",udp_headers);
   udp_headers=udp_headers+1;
  end
  if(m_udp_payload_axis_tvalid&&m_udp_payload_axis_tready)begin
   if(m_udp_payload_axis_tlast)udp_frame_active=0;
   if(rx_packets>=N)$fatal(1,"Unexpected UDP payload after invalid input");
   if(m_udp_payload_axis_tuser)$fatal(1,"Unexpected received UDP error");
   if(m_udp_payload_axis_tdata!==payload[rx_offset+rx_position])$fatal(1,"RX payload mismatch packet=%0d byte=%0d",rx_packets,rx_position);
   if(m_udp_payload_axis_tlast !== (rx_position==lengths[rx_packets]-1))$fatal(1,"RX last mismatch");
   rx_position=rx_position+1;
   if(m_udp_payload_axis_tlast)begin rx_offset=rx_offset+rx_position;rx_position=0;rx_packets=rx_packets+1;end
  end
 end
end
task send_udp(input integer id,input integer start,input integer n,input [31:0] dest);
 integer p;
 begin
  @(negedge clk);s_udp_ip_dscp=0;s_udp_ip_ecn=0;s_udp_ip_ttl=64;s_udp_ip_source_ip=32'hc0a8010a;s_udp_ip_dest_ip=dest;
  s_udp_source_port=4000+id;s_udp_dest_port=5000+id;s_udp_length=n+8;s_udp_checksum=0;s_udp_hdr_valid=1;
  do @(posedge clk);while(!s_udp_hdr_ready);
  @(negedge clk);s_udp_hdr_valid=0;
  for(p=0;p<n;p=p+1)begin
   repeat((p+id)%3==0?1:0)@(negedge clk);
   s_udp_payload_axis_tvalid=1;s_udp_payload_axis_tdata=payload[start+p];s_udp_payload_axis_tlast=(p==n-1);s_udp_payload_axis_tuser=0;
   do @(posedge clk);while(!s_udp_payload_axis_tready);
   @(negedge clk);s_udp_payload_axis_tvalid=0;s_udp_payload_axis_tlast=0;
  end
 end
endtask
task send_eth(input integer kind,input integer start,input integer n);
 integer p;
 begin
  @(negedge clk);s_eth_dest_mac=48'h020000000001;s_eth_src_mac=48'h020000000002;s_eth_type=kind==1?16'h0806:16'h0800;s_eth_hdr_valid=1;
  do @(posedge clk);while(!s_eth_hdr_ready);
  @(negedge clk);s_eth_hdr_valid=0;
  for(p=0;p<n;p=p+1)begin
   repeat((p+start)%5==0?1:0)@(negedge clk);
   s_eth_payload_axis_tvalid=1;s_eth_payload_axis_tlast=p==n-1;s_eth_payload_axis_tuser=0;
   if(kind==1)s_eth_payload_axis_tdata=arp_vectors[start+p];
   else if(kind==2)s_eth_payload_axis_tdata=bad_vectors[p];
   else s_eth_payload_axis_tdata=rx_vectors[start+p];
   do @(posedge clk);while(!s_eth_payload_axis_tready);
   @(negedge clk);s_eth_payload_axis_tvalid=0;s_eth_payload_axis_tlast=0;
  end
 end
endtask
integer poff=0,foff=0;
initial begin
 lengths[0]=1;
 lengths[1]=2;
 lengths[2]=3;
 lengths[3]=7;
 lengths[4]=8;
 lengths[5]=15;
 lengths[6]=16;
 lengths[7]=17;
 lengths[8]=31;
 lengths[9]=32;
 lengths[10]=63;
 lengths[11]=64;
 lengths[12]=127;
 lengths[13]=128;
 lengths[14]=255;
 lengths[15]=256;
 lengths[16]=511;
 lengths[17]=512;
 lengths[18]=1023;
 lengths[19]=1024;
 lengths[20]=1471;
 lengths[21]=1472;
 lengths[22]=92;
 lengths[23]=825;
 lengths[24]=86;
 lengths[25]=819;
 lengths[26]=80;
 lengths[27]=813;
 lengths[28]=74;
 lengths[29]=807;
 lengths[30]=68;
 lengths[31]=801;
 lengths[32]=62;
 lengths[33]=795;
 lengths[34]=56;
 lengths[35]=789;
 lengths[36]=50;
 lengths[37]=783;
 lengths[38]=44;
 lengths[39]=777;
 lengths[40]=38;
 lengths[41]=771;
 lengths[42]=32;
 lengths[43]=765;
 lengths[44]=26;
 lengths[45]=759;
 lengths[46]=20;
 lengths[47]=753;
 lengths[48]=14;
 lengths[49]=747;
 lengths[50]=8;
 lengths[51]=741;
 lengths[52]=2;
 lengths[53]=735;
 lengths[54]=1468;
 lengths[55]=729;
 lengths[56]=1462;
 lengths[57]=723;
 lengths[58]=1456;
 lengths[59]=717;
 lengths[60]=1450;
 lengths[61]=711;
 lengths[62]=1444;
 lengths[63]=705;
 $readmemh("E:/GPTProject2/EDAAgent/projects/system-bench/udp/tx.hex",tx_expected);$readmemh("E:/GPTProject2/EDAAgent/projects/system-bench/udp/rx.hex",rx_vectors);$readmemh("E:/GPTProject2/EDAAgent/projects/system-bench/udp/payload.hex",payload);$readmemh("E:/GPTProject2/EDAAgent/projects/system-bench/udp/arp.hex",arp_vectors);$readmemh("E:/GPTProject2/EDAAgent/projects/system-bench/udp/bad.hex",bad_vectors);
 rst=1;local_mac=48'h020000000001;local_ip=32'hc0a8010a;gateway_ip=32'hc0a80101;subnet_mask=32'hffffff00;
 repeat(8)@(negedge clk);rst=0;repeat(100)@(negedge clk);
 current_case=1;
 send_udp(0,0,lengths[0],32'hc0a80114);
 wait(arp_packets==1);send_eth(1,0,28);wait(tx_packets==1);
 $display("UDP_CASE_PASS cold_arp_resolution");
 send_eth(0,0,lengths[0]+28);wait(rx_packets==1);
 poff=lengths[0];foff=lengths[0]+28;
 for(i=1;i<N;i=i+1)begin
  current_case=i+1;
  fork
   send_udp(i,poff,lengths[i],32'hc0a80114);
   send_eth(0,foff,lengths[i]+28);
  join
  wait(tx_packets==i+1 && rx_packets==i+1);
  poff=poff+lengths[i];foff=foff+lengths[i]+28;
  if(i%8==7)$display("UDP_PROGRESS bidirectional_packets=%0d payload_bytes=%0d",2*(i+1),poff*2);
 end
 if(arp_packets!=1)$fatal(1,"Warm ARP cache unexpectedly missed");
 current_case=65;before_arp=arp_packets;send_eth(1,28,28);wait(arp_packets==before_arp+1);
 if(arp_bytes[7]!=2)$fatal(1,"Peer ARP request did not receive reply");
 $display("UDP_CASE_PASS peer_arp_reply");
 current_case=66;
 for(j=0;j<8;j=j+1)begin send_eth(2,0,60);repeat(100)@(negedge clk);end
 if(invalid_checksums!=8)$fatal(1,"Bad checksum error count %0d",invalid_checksums);
 current_case=67;
 for(j=0;j<8;j=j+1)begin send_eth(0,0,10);repeat(100)@(negedge clk);end
 if(short_headers!=8)$fatal(1,"Short header error count %0d",short_headers);
 if(rx_packets!=64 || udp_headers!=64)$fatal(1,"Invalid frames leaked to UDP output");
 $display("UDP_CASE_PASS malformed_ipv4 checksum=8 truncated=8");
 current_case=68;before_arp=arp_packets;
 send_udp(0,0,1,32'hc0a80163);wait(arp_errors==1);repeat(100)@(negedge clk);
 if(arp_packets-before_arp!=4)$fatal(1,"Expected 4 unanswered ARP requests, got %0d",arp_packets-before_arp);
 if(tx_packets!=64 || ip_headers!=64)$fatal(1,"ARP failure leaked IP packet");
 $display("UDP_CASE_PASS arp_timeout requests=4");
 current_case=69;base_tx=tx_packets;base_rx=rx_packets;base_bytes=rx_offset*2;before_arp=arp_packets;
 @(negedge clk);rst=1;repeat(8)@(negedge clk);
 tx_packets=0;rx_packets=0;ip_headers=0;udp_headers=0;tx_offset=0;rx_offset=0;tx_position=0;rx_position=0;arp_pos=0;
 rst=0;repeat(100)@(negedge clk);
 send_udp(0,0,1,32'hc0a80114);wait(arp_packets==before_arp+1);send_eth(1,0,28);wait(tx_packets==1);
 send_eth(0,0,29);wait(rx_packets==1);repeat(100)@(negedge clk);
 if(arp_packets!=before_arp+1 || arp_errors!=1 || invalid_checksums!=8 || short_headers!=8)$fatal(1,"Reset recovery unexpectedly changed error counts");
 $display("UDP_CASE_PASS reset_recovery cold_arp=1 tx_packets=1 rx_packets=1");
 $display("SYSTEM_BENCH_PASS project=udp tx_packets=%0d rx_packets=%0d payload_bytes=%0d invalid_checksum=%0d truncated_header=%0d arp_frames=%0d arp_failures=%0d cycles=%0d",base_tx+tx_packets,base_rx+rx_packets,base_bytes+rx_offset*2,invalid_checksums,short_headers,arp_packets,arp_errors,cycles);
 $finish;
end
endmodule
