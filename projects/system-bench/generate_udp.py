"""Build a full UDP/IPv4/ARP integration and independent packet-byte oracle."""
import json,pathlib,re,struct,hashlib
from prepare import prepare
ROOT=pathlib.Path(__file__).resolve().parents[2]
D=ROOT/'projects/system-bench/udp';D.mkdir(exist_ok=True)
rtl=(ROOT/'vendor/verilog-ethernet/rtl/udp_complete.v').read_text()
ports=re.findall(r'^\s*(input|output)\s+wire\s*(\[[^\]]+\])?\s*(\w+)\s*,?\s*$',rtl,re.M)
assert len(ports)>100
decl=',\n'.join(f'    {a} wire {b} {c}' for a,b,c in ports)
inst=',\n'.join(f'    .{c}({c})' for a,b,c in ports)
(D/'udp_top.v').write_text('`timescale 1ns/1ps\nmodule udp_top(\n'+decl+'\n);\nudp_complete #(\n .ARP_CACHE_ADDR_WIDTH(4),\n .ARP_REQUEST_RETRY_COUNT(4),\n .ARP_REQUEST_RETRY_INTERVAL(1000),\n .ARP_REQUEST_TIMEOUT(2000),\n .UDP_CHECKSUM_GEN_ENABLE(1),\n .UDP_CHECKSUM_PAYLOAD_FIFO_DEPTH(2048),\n .UDP_CHECKSUM_HEADER_FIFO_DEPTH(8)\n) stack (\n'+inst+'\n);\nendmodule\n')
LM=bytes.fromhex('020000000001');RM=bytes.fromhex('020000000002')
LI=bytes([192,168,1,10]);RI=bytes([192,168,1,20])
def checksum(b):
    if len(b)%2:b+=b'\x00'
    v=sum(struct.unpack('!'+str(len(b)//2)+'H',b))
    while v>>16:v=(v&65535)+(v>>16)
    return (~v)&65535
def ip(payload,src,dst,sport,dport):
    u=struct.pack('!HHHH',sport,dport,len(payload)+8,0)+payload
    cs=checksum(src+dst+bytes([0,17])+struct.pack('!H',len(u))+u)
    u=u[:6]+struct.pack('!H',cs or 65535)+u[8:]
    h=struct.pack('!BBHHHBBH',0x45,0,len(u)+20,0,0x4000,64,17,0)+src+dst
    h=h[:10]+struct.pack('!H',checksum(h))+h[12:]
    assert checksum(h)==0
    return h+u
def arp(op,sha,spa,tha,tpa):return struct.pack('!HHBBH',1,0x800,6,4,op)+sha+spa+tha+tpa
lengths=[1,2,3,7,8,15,16,17,31,32,63,64,127,128,255,256,511,512,1023,1024,1471,1472]+[1+((n*733+91)%1472) for n in range(42)]
payloads=[bytes(((j*29+i*73)^(j>>3)^((i+11)*7))&255 for j in range(n)) for i,n in enumerate(lengths)]
tx=b''.join(ip(p,LI,RI,4000+i,5000+i) for i,p in enumerate(payloads))
rx=b''.join(ip(p,RI,LI,4000+i,5000+i) for i,p in enumerate(payloads))
pay=b''.join(payloads)
ar=arp(2,RM,RI,LM,LI)+arp(1,RM,RI,bytes(6),LI)
bad=bytearray(ip(bytes(range(32)),RI,LI,4000,5000));bad[10]^=1
for name,data in [('tx',tx),('rx',rx),('payload',pay),('arp',ar),('bad',bad)]:
    (D/f'{name}.hex').write_text(''.join(f'{x:02x}\n' for x in data))
    assert bytes(int(x,16) for x in (D/f'{name}.hex').read_text().split())==bytes(data)
manifest={'upstream':'https://github.com/alexforencich/verilog-ethernet','commit':'77320a9471d19c7dd383914bc049e02d9f4f1ffb','license':'MIT','valid_tx_packets':65,'valid_rx_packets':65,'payload_bytes_each_direction':len(pay)+1,'payload_lengths':lengths,'malformed_ipv4_checksum_frames':8,'truncated_ipv4_headers':8,'arp_cases':['cold lookup','warm cache','respond to peer ARP request','4-attempt timeout','reset and cold-cache recovery'],'scenario_families':['bidirectional packet byte correctness with 64 payload lengths','generated UDP and IPv4 checksums','AXIS backpressure stability','cold and cached ARP resolution','ARP responder','invalid IPv4 checksum rejection','truncated IPv4 header rejection','ARP timeout retry and no leaked IP frame','reset and cold-cache recovery'],'oracle':'Python Internet checksum plus complete Ethernet-payload byte comparison','scope':'Ethernet frame interface; no MAC, PHY, FCS or hardware test; received UDP checksum is exposed, not validated by this core','test_timer_parameters':{'retry_interval_cycles':1000,'timeout_cycles':2000},'vector_sha256':{n:hashlib.sha256((D/f'{n}.hex').read_bytes()).hexdigest() for n in ['tx','rx','payload','arp','bad']}}
(D/'manifest.json').write_text(json.dumps(manifest,indent=2))
regs='\n'.join(f'{"reg" if a=="input" else "wire"} {b} {c}'+('=0;' if a=='input' else ';') for a,b,c in ports)
path=lambda n:(D/f'{n}.hex').as_posix()
tb=r'''`timescale 1ns/1ps
module tb_udp;
@REGS@
always #5 clk=~clk;
udp_top dut(.*);
localparam N=64;
integer lengths[0:N-1];
reg [7:0] tx_expected[0:@TXMAX@],rx_vectors[0:@TXMAX@],payload[0:@PAYMAX@],arp_vectors[0:55],bad_vectors[0:59];
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
 @LENGTHS@
 $readmemh("@TXPATH@",tx_expected);$readmemh("@RXPATH@",rx_vectors);$readmemh("@PAYPATH@",payload);$readmemh("@ARPPATH@",arp_vectors);$readmemh("@BADPATH@",bad_vectors);
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
'''
for k,v in {'REGS':regs,'TXMAX':len(tx)-1,'PAYMAX':len(pay)-1,'LENGTHS':'\n '.join(f'lengths[{i}]={n};' for i,n in enumerate(lengths)),'TXPATH':path('tx'),'RXPATH':path('rx'),'PAYPATH':path('payload'),'ARPPATH':path('arp'),'BADPATH':path('bad')}.items():tb=tb.replace('@'+k+'@',str(v))
(D/'tb_udp.sv').write_text(tb)
names=['udp_complete','udp','udp_checksum_gen','udp_ip_rx','udp_ip_tx','ip_complete','ip','ip_eth_rx','ip_eth_tx','ip_arb_mux','arp','arp_cache','arp_eth_rx','arp_eth_tx','eth_arb_mux','lfsr']
sources=[f'vendor/verilog-ethernet/rtl/{n}.v' for n in names]+[f'vendor/verilog-ethernet/lib/axis/rtl/{n}.v' for n in ['arbiter','priority_encoder','axis_fifo']]+['projects/system-bench/udp/udp_top.v']
prepare('udp','udp_top',sources)
impl=D/'implement.tcl'
impl.write_text(impl.read_text().replace('set_param general.maxThreads 2','set_param general.maxThreads 2\nset_param synth.maxThreads 1\nset prep [file join $::env(XILINX_VIVADO) scripts rt fpga_tcl rtSynthParallelPrep.tcl]\nputs "UDP_SYNTH_PREFLIGHT path=$prep exists=[file exists $prep] readable=[file readable $prep]"'))
manifest['source_files']=len(sources);manifest['compiled_source_lines']=sum(len((ROOT/p).read_text().splitlines()) for p in sources)
(D/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(json.dumps({'project':'udp','tx_packets':len(lengths)+1,'rx_packets':len(lengths)+1,'payload_bytes':(len(pay)+1)*2,'rtl_lines':manifest['compiled_source_lines']}))
