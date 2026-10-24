"""Generate raw-GMII oracle and a complete three-clock UDP echo system."""
import pathlib,json,re,struct,zlib,hashlib
D=pathlib.Path(__file__).resolve().parent;ROOT=D.parents[2]
V=ROOT/'vendor/verilog-ethernet'
ports=re.findall(r'^\s*(input|output)\s+wire\s*(\[[^\]]+\])?\s*(\w+)\s*,?\s*$',(V/'rtl/udp_complete.v').read_text(),re.M)
wires='\n'.join(f'wire {b} {c};' for a,b,c in ports if c not in ('clk','rst'))
conns=',\n'.join(f'.{c}({"logic_clk" if c=="clk" else "logic_rst" if c=="rst" else c})' for a,b,c in ports)
tie='\n'.join(f'assign {c}=0;' for a,b,c in ports if a=='input' and c.startswith('s_ip_'))
top=r'''`timescale 1ns/1ps
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
@WIRES@
eth_axis_rx ethernet_decoder(.clk(logic_clk),.rst(logic_rst),
 .s_axis_tdata(filtered_data),.s_axis_tkeep(1'b1),.s_axis_tvalid(filtered_valid),.s_axis_tready(filtered_ready),.s_axis_tlast(filtered_last),.s_axis_tuser(filtered_user),
 .m_eth_hdr_valid(s_eth_hdr_valid),.m_eth_hdr_ready(s_eth_hdr_ready),.m_eth_dest_mac(s_eth_dest_mac),.m_eth_src_mac(s_eth_src_mac),.m_eth_type(s_eth_type),
 .m_eth_payload_axis_tdata(s_eth_payload_axis_tdata),.m_eth_payload_axis_tvalid(s_eth_payload_axis_tvalid),.m_eth_payload_axis_tready(s_eth_payload_axis_tready),.m_eth_payload_axis_tlast(s_eth_payload_axis_tlast),.m_eth_payload_axis_tuser(s_eth_payload_axis_tuser));
eth_axis_tx ethernet_encoder(.clk(logic_clk),.rst(logic_rst),
 .s_eth_hdr_valid(m_eth_hdr_valid),.s_eth_hdr_ready(m_eth_hdr_ready),.s_eth_dest_mac(m_eth_dest_mac),.s_eth_src_mac(m_eth_src_mac),.s_eth_type(m_eth_type),
 .s_eth_payload_axis_tdata(m_eth_payload_axis_tdata),.s_eth_payload_axis_tkeep(1'b1),.s_eth_payload_axis_tvalid(m_eth_payload_axis_tvalid),.s_eth_payload_axis_tready(m_eth_payload_axis_tready),.s_eth_payload_axis_tlast(m_eth_payload_axis_tlast),.s_eth_payload_axis_tuser(m_eth_payload_axis_tuser),
 .m_axis_tdata(mac_tx_data),.m_axis_tvalid(mac_tx_valid),.m_axis_tready(mac_tx_ready),.m_axis_tlast(mac_tx_last),.m_axis_tuser(mac_tx_user));
@TIE@
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
@CONNS@
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
'''
for k,v in dict(WIRES=wires,TIE=tie,CONNS=conns).items():top=top.replace('@'+k+'@',v)
(D/'ethernet_cdc_top.v').write_text(top)
LM=bytes.fromhex('020000000001');RM=bytes.fromhex('020000000002');LI=bytes([192,168,1,10]);RI=bytes([192,168,1,20])
def checksum(b):
 if len(b)%2:b+=b'\0'
 v=sum(struct.unpack('!'+str(len(b)//2)+'H',b))
 while v>>16:v=(v&65535)+(v>>16)
 return (~v)&65535
def ip(p,src,dst,sp,dp):
 u=struct.pack('!HHHH',sp,dp,len(p)+8,0)+p
 cs=checksum(src+dst+b'\0\x11'+struct.pack('!H',len(u))+u)
 u=u[:6]+struct.pack('!H',cs or 65535)+u[8:]
 h=struct.pack('!BBHHHBBH',0x45,0,len(u)+20,0,0x4000,64,17,0)+src+dst
 h=h[:10]+struct.pack('!H',checksum(h))+h[12:]
 return h+u
def eth(p,dst,src,typ=0x800):
 f=dst+src+struct.pack('!H',typ)+p;f+=bytes(max(0,60-len(f)))
 return b'\x55'*7+b'\xd5'+f+struct.pack('<I',zlib.crc32(f))
def arp(op,sha,spa,tha,tpa):return struct.pack('!HHBBH',1,0x800,6,4,op)+sha+spa+tha+tpa
arprequest=eth(arp(1,LM,LI,bytes(6),RI),b'\xff'*6,LM,0x806)
arpreply=eth(arp(2,RM,RI,LM,LI),LM,RM,0x806)
lengths=[1,2,3,8,17,18,19,31,32,63,64,127,128,255,256,511,512,1023,1024,1471,1472]+[1+(i*733+91)%1472 for i in range(235)]+[37+i*3 for i in range(24)]+[1472]
payloads=[bytes(((j*29+i*73)^(j>>3)^((i+11)*7))&255 for j in range(n)) for i,n in enumerate(lengths)]
valid=[eth(ip(p,RI,LI,4000+i,5000+i),LM,RM) for i,p in enumerate(payloads)]
echo=[eth(ip(p,LI,RI,5000+i,4000+i),RM,LM) for i,p in enumerate(payloads)]
negative=[];negative_classes=[]
for kind in range(6):
 for k in range(4):
  p=bytes((j+kind*13+k)&255 for j in range(96+k));packet=bytearray(ip(p,RI,LI,6000,7000))
  if kind in (3,4):
   packet[2:4]=struct.pack('!H',10 if kind==3 else len(packet)+128)
   packet[10:12]=b'\0\0';packet[10:12]=struct.pack('!H',checksum(bytes(packet[:20])))
  if kind==5:packet[10]^=1
  frame=bytearray(eth(bytes(packet),LM,RM))
  if kind==0:frame[-1]^=1
  if kind==1:frame=frame[:38+k]
  negative.append(bytes(frame));negative_classes.append(kind)
out=[arprequest]+echo[:-1]+[arprequest,echo[-1]]
def pack(name,frames):
 data=b''.join(frames);offs=[];p=0
 for f in frames:offs.append(p);p+=len(f)
 (D/f'{name}.hex').write_text(''.join(f'{x:02x}\n' for x in data))
 return offs,[len(f) for f in frames],len(data)
vo,vl,vn=pack('valid',valid);no,nl,nn=pack('negative',negative);eo,el,en=pack('expected',out);ao,al,an=pack('arp',[arpreply])
bad=bytearray(b''.join(out));bad[len(arprequest)-1]^=1
(D/'expected-corrupt.hex').write_text(''.join(f'{x:02x}\n' for x in bad))
arrays='\n'.join(f'{name}[{i}]={v};' for name,values in [('vo',vo),('vl',vl),('no',no),('nl',nl),('eo',eo),('el',el)] for i,v in enumerate(values))
tb=r'''`timescale 1ns/1ps
module @TB@;
reg logic_clk=0,rx_clk=0,tx_clk=0,reset=1,app_pause=0,forced_pause=0;
initial begin #1.7;forever #@LH@ logic_clk=~logic_clk;end
initial begin #2.3;forever #@RH@ rx_clk=~rx_clk;end
initial begin #3.1;forever #@TH@ tx_clk=~tx_clk;end
reg[7:0] gmii_rxd=0;reg gmii_rx_dv=0,gmii_rx_er=0;
wire[7:0] gmii_txd;wire gmii_tx_en,gmii_tx_er,logic_rst,rx_rst,tx_rst,rx_bad_frame,rx_bad_fcs,rx_overflow,tx_underflow,guard_rejected,ip_bad_checksum;
wire[31:0] app_received,app_echoed;
ethernet_cdc_top dut(.*);
reg[7:0] valid_rom[0:@VN@],negative_rom[0:@NN@],expected_rom[0:@EN@],arp_rom[0:@AN@];
integer vo[0:280],vl[0:280],no[0:23],nl[0:23],eo[0:282],el[0:282];
integer cycles=0,frames=0,position=0,tx_wire_bytes=0,bad_fcs_count=0,bad_frame_count=0,guard_count=0,checksum_count=0;
integer stall_cycles=0,pause_cycles=0,burst=0,current_case=0,i,j,before_frames,before_fcs,before_bad,before_guard,before_checksum;
integer echo_stall_cycles=0,rx_app_stall_cycles=0,mac_tx_stall_cycles=0;
reg in_frame=0;reg[31:0] lfsr=32'h9854ace1;
reg held=0;reg[9:0] held_value;
always @(negedge logic_clk)begin
 lfsr={lfsr[30:0],lfsr[31]^lfsr[21]^lfsr[1]^lfsr[0]};
 app_pause=!logic_rst && (forced_pause || cycles%311<47);
end
always @(posedge logic_clk)begin
 cycles=cycles+1;
 if(cycles>3000000)$fatal(1,"TIMEOUT ethernet_cdc");
 if(!logic_rst)begin
  if(rx_bad_fcs)bad_fcs_count=bad_fcs_count+1;
  if(rx_bad_frame)bad_frame_count=bad_frame_count+1;
  if(guard_rejected)guard_count=guard_count+1;
  if(ip_bad_checksum)checksum_count=checksum_count+1;
  if(rx_overflow||tx_underflow)$fatal(1,"Unexpected FIFO overflow / MAC TX underflow");
  if(dut.mac_rx_valid&&!dut.mac_rx_ready)stall_cycles=stall_cycles+1;
  if(dut.s_udp_payload_axis_tvalid&&!dut.s_udp_payload_axis_tready)echo_stall_cycles=echo_stall_cycles+1;
  if(dut.m_udp_payload_axis_tvalid&&!dut.m_udp_payload_axis_tready)rx_app_stall_cycles=rx_app_stall_cycles+1;
  if(dut.mac_tx_valid&&!dut.mac_tx_ready)mac_tx_stall_cycles=mac_tx_stall_cycles+1;
  if(app_pause)pause_cycles=pause_cycles+1;
  if(held && (!dut.s_udp_payload_axis_tvalid || held_value!=={dut.s_udp_payload_axis_tuser,dut.s_udp_payload_axis_tlast,dut.s_udp_payload_axis_tdata}))$fatal(1,"Echo AXIS stability violation");
  held=dut.s_udp_payload_axis_tvalid&&!dut.s_udp_payload_axis_tready;
  held_value={dut.s_udp_payload_axis_tuser,dut.s_udp_payload_axis_tlast,dut.s_udp_payload_axis_tdata};
 end else held=0;
end
always @(posedge tx_clk)begin
 if(!tx_rst)begin
  if(gmii_tx_er)$fatal(1,"GMII TX error");
  if(gmii_tx_en)begin
   if(frames>=283)$fatal(1,"Unexpected extra GMII output frame");
   if(position>=el[frames])$fatal(1,"Oversize output frame %0d",frames);
   if(gmii_txd!==expected_rom[eo[frames]+position])$fatal(1,"GMII_BYTE_MISMATCH frame=%0d byte=%0d got=%02x expected=%02x",frames,position,gmii_txd,expected_rom[eo[frames]+position]);
   position=position+1;tx_wire_bytes=tx_wire_bytes+1;in_frame=1;
  end else if(in_frame)begin
   if(position!=el[frames])$fatal(1,"Short GMII output frame=%0d got=%0d expected=%0d",frames,position,el[frames]);
   frames=frames+1;position=0;in_frame=0;
  end
 end else begin
  if(in_frame)$fatal(1,"Unexpected reset during TX frame");
 end
end
task send_frame(input integer kind,input integer id,input integer cut);
 integer p,n,off;reg[7:0] value;
 begin
  if(kind==0)begin n=vl[id];off=vo[id];end
  else if(kind==1)begin n=nl[id];off=no[id];end
  else begin n=@AN@+1;off=0;end
  if(cut>0)n=cut;
  @(negedge rx_clk);
  for(p=0;p<n;p=p+1)begin
   if(kind==0)value=valid_rom[off+p];else if(kind==1)value=negative_rom[off+p];else value=arp_rom[p];
   gmii_rx_dv=1;gmii_rxd=value;gmii_rx_er=kind==1 && id/4==2 && p==27;
   @(negedge rx_clk);
  end
  gmii_rx_dv=0;gmii_rx_er=0;gmii_rxd=0;
  repeat(12)@(negedge rx_clk);
 end
endtask
initial begin
 @ARRAYS@
 $readmemh("@VALID@",valid_rom);$readmemh("@NEGATIVE@",negative_rom);$readmemh("@EXPECTED@",expected_rom);$readmemh("@ARP@",arp_rom);
 #143.7;reset=0;repeat(100)@(negedge logic_clk);
 current_case=1;send_frame(0,0,0);wait(frames==1);send_frame(2,0,0);wait(frames==2);
 $display("CDC_CASE_PASS cold_arp_full_mac");
 for(i=1;i<256;i=i+1)begin
  if(i==16)forced_pause=1;
  current_case=2;send_frame(0,i,0);
  if(i==23)begin repeat(400)@(negedge logic_clk);forced_pause=0;end
  if((i%4==3 && i!=19) || i==255)wait(frames==i+2);
  if(i%64==63)$display("CDC_PROGRESS valid_echoes=%0d wire_bytes=%0d",i+1,tx_wire_bytes);
 end
 for(i=0;i<24;i=i+1)begin
  current_case=10+i/4;before_frames=frames;before_fcs=bad_fcs_count;before_bad=bad_frame_count;before_guard=guard_count;before_checksum=checksum_count;
  send_frame(1,i,0);repeat(500)@(negedge logic_clk);
  if(frames!=before_frames)$fatal(1,"Malformed ingress leaked output class=%0d",i/4);
  if(i/4==0 && bad_fcs_count!=before_fcs+1)$fatal(1,"Missing bad FCS status");
  if((i/4==1 || i/4==2) && bad_frame_count!=before_bad+1)$fatal(1,"Missing truncated/ER bad frame status");
  if((i/4==3 || i/4==4) && guard_count!=before_guard+1)$fatal(1,"Missing IPv4 length guard rejection");
  if(i/4==5 && checksum_count!=before_checksum+1)$fatal(1,"Missing IPv4 checksum rejection");
  send_frame(0,256+i,0);wait(frames==before_frames+1);
  if(i%4==3)$display("CDC_CASE_PASS negative_class=%0d rejected=4 recovered=4",i/4);
 end
 current_case=20;
 // Assert reset partway through a long GMII ingress frame, before its FCS.
 @(negedge rx_clk);gmii_rx_dv=1;
 for(j=0;j<120;j=j+1)begin gmii_rxd=valid_rom[vo[280]+j];@(negedge rx_clk);end
 #2.7;reset=1;#19.1;gmii_rx_dv=0;gmii_rxd=0;#103.3;reset=0;
 repeat(150)@(negedge logic_clk);
 if(frames!=281)$fatal(1,"Partial frame leaked across reset");
 send_frame(0,280,0);wait(frames==282);send_frame(2,0,0);wait(frames==283);repeat(100)@(negedge logic_clk);
 if(bad_fcs_count<8 || bad_frame_count!=12 || guard_count!=8 || checksum_count!=4)$fatal(1,"Unexpected negative status totals fcs=%0d bad=%0d guard=%0d checksum=%0d",bad_fcs_count,bad_frame_count,guard_count,checksum_count);
 if(pause_cycles==0 || stall_cycles==0)$fatal(1,"No actual MAC RX backpressure observed mac_rx=%0d echo=%0d rx_app=%0d mac_tx=%0d",stall_cycles,echo_stall_cycles,rx_app_stall_cycles,mac_tx_stall_cycles);
 $display("CDC_CASE_PASS reset_mid_ingress recovery=1");
 $display("HARD_BENCH_PASS project=ethernet-cdc ratio=@RATIO@ valid_echoes=281 output_frames=%0d checked_wire_bytes=%0d negative_classes=6 negative_inputs=24 bad_fcs=%0d bad_frame=%0d length_rejected=%0d ip_checksum_rejected=%0d pause_cycles=%0d rx_stall_cycles=%0d echo_stall_cycles=%0d rx_app_stall_cycles=%0d mac_tx_stall_cycles=%0d cycles=%0d",frames,tx_wire_bytes,bad_fcs_count,bad_frame_count,guard_count,checksum_count,pause_cycles,stall_cycles,echo_stall_cycles,rx_app_stall_cycles,mac_tx_stall_cycles,cycles);
 $finish;
end
endmodule
'''
base={'VN':vn-1,'NN':nn-1,'EN':en-1,'AN':an-1,'ARRAYS':arrays,'VALID':(D/'valid.hex').as_posix(),'NEGATIVE':(D/'negative.hex').as_posix(),'ARP':(D/'arp.hex').as_posix()}
for mode,ratio,clocks,expected in [('a','a',(5,4,4.3),'expected'),('b','b',(3.7,5.3,3.1),'expected'),('negative','a',(5,4,4.3),'expected-corrupt')]:
 t=tb
 for k,v in dict(base,TB='tb_ethernet_cdc_'+mode,LH=clocks[0],RH=clocks[1],TH=clocks[2],RATIO=ratio,EXPECTED=(D/f'{expected}.hex').as_posix()).items():t=t.replace('@'+k+'@',str(v))
 (D/f'tb_{mode}.sv').write_text(t)
names=['udp_complete','udp','udp_checksum_gen','udp_ip_rx','udp_ip_tx','ip_complete','ip','ip_eth_rx','ip_eth_tx','ip_arb_mux','arp','arp_cache','arp_eth_rx','arp_eth_tx','eth_arb_mux','lfsr','eth_mac_1g_fifo','eth_mac_1g','axis_gmii_rx','axis_gmii_tx','eth_axis_rx','eth_axis_tx']
sources=[f'vendor/verilog-ethernet/rtl/{n}.v' for n in names]+[f'vendor/verilog-ethernet/lib/axis/rtl/{n}.v' for n in ['arbiter','priority_encoder','axis_fifo','axis_adapter','axis_async_fifo','axis_async_fifo_adapter','sync_reset']]+['projects/hard-bench/ethernet-cdc/ethernet_cdc_top.v']
(D/'sources.json').write_text(json.dumps({'top':'ethernet_cdc_top','sources':sources},indent=2))
for mode in ['a','b','negative']:(D/f'sim-{mode}.json').write_text(json.dumps({'sources':sources+[f'projects/hard-bench/ethernet-cdc/tb_{mode}.sv'],'top':'tb_ethernet_cdc_'+mode,'capture_top_wave':mode=='a'},indent=2))
manifest={'upstream_commit':'77320a9471d19c7dd383914bc049e02d9f4f1ffb','license':'MIT','baseline_frames':256,'baseline_distinct_lengths':len(set(lengths[:256])),'fault_recovery_frames':24,'reset_recovery_frames':1,'valid_echoes_per_ratio':281,'payload_bytes_per_ratio':sum(lengths),'complete_output_frames_per_ratio':len(out),'checked_wire_bytes_per_ratio':en,'negative_classes':['bad FCS','truncated GMII frame','GMII RX_ER','IPv4 total_length below header','IPv4 total_length beyond received bytes','IPv4 checksum'],'vectors_per_negative_class':4,'clock_periods_ns':{'a':{'logic':10,'rx':8,'tx':8.6},'b':{'logic':7.4,'rx':10.6,'tx':6.2}},'compiled_source_files':len(sources),'compiled_RTL_lines':sum(len((ROOT/p).read_text().splitlines()) for p in sources),'source_sha256':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in sources},'vector_sha256':{p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in D.glob('*.hex')},'other_model_API_calls':0}
(D/'manifest.json').write_text(json.dumps(manifest,indent=2));print(json.dumps({k:v for k,v in manifest.items() if k not in ['source_sha256','vector_sha256']},indent=2))
