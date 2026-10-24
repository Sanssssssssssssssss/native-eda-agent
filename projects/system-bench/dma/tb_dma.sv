`timescale 1ns/1ps
module tb_dma #(parameter NEGATIVE_CONTROL=0);
reg clk=0;always #5 clk=~clk;
reg rst=1,req_valid=0;wire req_ready,done;
reg[15:0] src_addr=0,dst_addr=0,length=0;reg[7:0] tag=0;
wire[3:0] read_error,write_error;wire[7:0] done_tag;wire[15:0] done_length;
wire [4-1:0] m_axi_awid;
wire [16-1:0] m_axi_awaddr;
wire [7:0] m_axi_awlen;
wire [2:0] m_axi_awsize;
wire [1:0] m_axi_awburst;
wire  m_axi_awlock;
wire [3:0] m_axi_awcache;
wire [2:0] m_axi_awprot;
wire  m_axi_awvalid;
reg  m_axi_awready=0;
wire [32-1:0] m_axi_wdata;
wire [4-1:0] m_axi_wstrb;
wire  m_axi_wlast;
wire  m_axi_wvalid;
reg  m_axi_wready=0;
reg [4-1:0] m_axi_bid=0;
reg [1:0] m_axi_bresp=0;
reg  m_axi_bvalid=0;
wire  m_axi_bready;
wire [4-1:0] m_axi_arid;
wire [16-1:0] m_axi_araddr;
wire [7:0] m_axi_arlen;
wire [2:0] m_axi_arsize;
wire [1:0] m_axi_arburst;
wire  m_axi_arlock;
wire [3:0] m_axi_arcache;
wire [2:0] m_axi_arprot;
wire  m_axi_arvalid;
reg  m_axi_arready=0;
reg [4-1:0] m_axi_rid=0;
reg [32-1:0] m_axi_rdata=0;
reg [1:0] m_axi_rresp=0;
reg  m_axi_rlast=0;
reg  m_axi_rvalid=0;
wire  m_axi_rready;
dma_top dut(.*);
reg[7:0] memory[0:65535],expected[0:32767];
reg[31:0] rng=32'hc001cafe,vector_rng=1,seed=1;
integer cycle=0,ar_count=0,aw_count=0,rbeats=0,wbeats=0,byte_checks=0;
integer raddr=0,waddr=0,rremain=0,wremain=0;
reg ractive=0,wactive=0;reg[3:0] rid_saved=0,wid_saved=0;
integer error_mode=0,mode=0,active_src=0,active_dst=0,active_len=0;
integer lane,case_id=0,reset_aborts=0,protocol_checks=0,write_bytes=0;
integer ar_stalls=0,aw_stalls=0,w_stalls=0,r_stalls=0,axis_stalls=0;
reg ar_wait=0,aw_wait=0,w_wait=0,r_wait=0,b_wait=0,axis_wait=0;
reg[63:0] ar_previous,aw_previous;
reg[36:0] w_previous,axis_previous;
reg[38:0] r_previous;
reg[5:0] b_previous;
// Address/data stalls are independent; VALID and payload stay held until accepted.
always @(negedge clk)begin
 if(rst)begin m_axi_arready=0;m_axi_awready=0;m_axi_wready=0;end
 else begin
   m_axi_arready=!ractive&&!m_axi_rvalid&&(mode==0||rng[0])&&(mode!=3||cycle%127<37);
   m_axi_awready=!wactive&&!m_axi_bvalid&&(mode==0||rng[1])&&(mode!=3||cycle%113<41);
   m_axi_wready=wactive&&(mode==0||rng[2:1]==0)&&mode!=2&&(mode!=3||cycle%97<29);
 end
end
always @(posedge clk)begin
 cycle<=cycle+1;rng<={rng[30:0],rng[31]^rng[21]^rng[1]^rng[0]};
 if(rst)begin
   ractive<=0;wactive<=0;m_axi_rvalid<=0;m_axi_bvalid<=0;
   ar_wait<=0;aw_wait<=0;w_wait<=0;r_wait<=0;b_wait<=0;axis_wait<=0;
 end else begin
   if(ar_wait&&(!m_axi_arvalid||{m_axi_arid,m_axi_araddr,m_axi_arlen,m_axi_arsize,m_axi_arburst,m_axi_arlock,m_axi_arcache,m_axi_arprot}!==ar_previous))$fatal(1,"AR_UNSTABLE");
   if(aw_wait&&(!m_axi_awvalid||{m_axi_awid,m_axi_awaddr,m_axi_awlen,m_axi_awsize,m_axi_awburst,m_axi_awlock,m_axi_awcache,m_axi_awprot}!==aw_previous))$fatal(1,"AW_UNSTABLE");
   if(w_wait&&(!m_axi_wvalid||{m_axi_wdata,m_axi_wstrb,m_axi_wlast}!==w_previous))$fatal(1,"W_UNSTABLE");
   if(r_wait&&(!m_axi_rvalid||{m_axi_rid,m_axi_rdata,m_axi_rresp,m_axi_rlast}!==r_previous))$fatal(1,"MODEL_R_UNSTABLE");
   if(b_wait&&(!m_axi_bvalid||{m_axi_bid,m_axi_bresp}!==b_previous))$fatal(1,"MODEL_B_UNSTABLE");
   if(axis_wait&&(!dut.in_valid||{dut.in_data,dut.in_keep,dut.in_last}!==axis_previous))$fatal(1,"AXIS_UNSTABLE");
   ar_wait<=m_axi_arvalid&&!m_axi_arready;aw_wait<=m_axi_awvalid&&!m_axi_awready;
   w_wait<=m_axi_wvalid&&!m_axi_wready;r_wait<=m_axi_rvalid&&!m_axi_rready;
   b_wait<=m_axi_bvalid&&!m_axi_bready;axis_wait<=dut.in_valid&&!dut.in_ready;
   ar_previous<={m_axi_arid,m_axi_araddr,m_axi_arlen,m_axi_arsize,m_axi_arburst,m_axi_arlock,m_axi_arcache,m_axi_arprot};
   aw_previous<={m_axi_awid,m_axi_awaddr,m_axi_awlen,m_axi_awsize,m_axi_awburst,m_axi_awlock,m_axi_awcache,m_axi_awprot};
   w_previous<={m_axi_wdata,m_axi_wstrb,m_axi_wlast};r_previous<={m_axi_rid,m_axi_rdata,m_axi_rresp,m_axi_rlast};
   b_previous<={m_axi_bid,m_axi_bresp};axis_previous<={dut.in_data,dut.in_keep,dut.in_last};
   protocol_checks<=protocol_checks+ar_wait+aw_wait+w_wait+r_wait+b_wait+axis_wait;
   ar_stalls<=ar_stalls+ar_wait;aw_stalls<=aw_stalls+aw_wait;w_stalls<=w_stalls+w_wait;
   r_stalls<=r_stalls+r_wait;axis_stalls<=axis_stalls+axis_wait;
   if(dut.rd_status&&dut.rd_tag!==dut.tag_reg)$fatal(1,"READ_TAG_MISMATCH");
   if(m_axi_arvalid&&m_axi_arready)begin
     if(m_axi_arsize!=2||m_axi_arburst!=1||m_axi_arlen>15)$fatal(1,"BAD_READ_BURST");
     if((m_axi_araddr&4095)+(m_axi_arlen+1)*4-(m_axi_araddr&3)>4096)$fatal(1,"READ_4K_CROSS");
     if((m_axi_araddr&65532)<(active_src&65532)||(m_axi_araddr&65532)+(m_axi_arlen+1)*4>((active_src+active_len+3)&65532))$fatal(1,"READ_OUTSIDE_SOURCE");
     ractive<=1;raddr<=m_axi_araddr&65532;rremain<=m_axi_arlen+1;rid_saved<=m_axi_arid;ar_count<=ar_count+1;
   end
   if(m_axi_rvalid&&m_axi_rready)begin
     m_axi_rvalid<=0;rbeats<=rbeats+1;raddr<=raddr+4;rremain<=rremain-1;
     if(rremain==1)ractive<=0;
   end
   if(ractive&&!m_axi_rvalid&&(mode==0||rng[4:3]==0)&&(mode!=3||cycle%131<43))begin
     m_axi_rvalid<=1;m_axi_rid<=rid_saved;m_axi_rlast<=rremain==1;
     m_axi_rdata<={memory[raddr+3],memory[raddr+2],memory[raddr+1],memory[raddr]};
     m_axi_rresp<=error_mode==1?2:(error_mode==2?3:0);
   end
   if(m_axi_awvalid&&m_axi_awready)begin
     if(m_axi_awsize!=2||m_axi_awburst!=1||m_axi_awlen>15)$fatal(1,"BAD_WRITE_BURST");
     if((m_axi_awaddr&4095)+(m_axi_awlen+1)*4-(m_axi_awaddr&3)>4096)$fatal(1,"WRITE_4K_CROSS");
     wactive<=1;waddr<=m_axi_awaddr&65532;wremain<=m_axi_awlen+1;wid_saved<=m_axi_awid;aw_count<=aw_count+1;
   end
   if(m_axi_wvalid&&m_axi_wready)begin
     if(m_axi_wlast!==(wremain==1))$fatal(1,"WLAST_MISMATCH");
     for(lane=0;lane<4;lane=lane+1)if(m_axi_wstrb[lane])begin
       if(waddr+lane<active_dst||waddr+lane>=active_dst+active_len)$fatal(1,"WRITE_OUTSIDE_DESTINATION");
       memory[waddr+lane]<=m_axi_wdata[8*lane+:8];write_bytes=write_bytes+1;
     end
     waddr<=waddr+4;wremain<=wremain-1;wbeats<=wbeats+1;
     if(wremain==1)begin
       wactive<=0;m_axi_bvalid<=1;m_axi_bid<=wid_saved;
       m_axi_bresp<=error_mode==3?2:(error_mode==4?3:0);
     end
   end
   if(m_axi_bvalid&&m_axi_bready)m_axi_bvalid<=0;
 end
end
function automatic[31:0] next_vector(input[31:0] value);
 reg[31:0] x;begin x=value^(value<<13);x=x^(x>>17);next_vector=x^(x<<5);end
endfunction
task automatic start_copy(input integer src,dst,n,err,stalls);
 integer i;
 begin
   if(src<4||dst<4||src+n+4>65536||dst+n+4>65536||!(src+n<=dst||dst+n<=src))$fatal(1,"INVALID_CASE");
   active_src=src;active_dst=dst;active_len=n;
   for(i=0;i<n+8;i=i+1)memory[dst-4+i]=8'ha5;
   for(i=0;i<n;i=i+1)begin
     expected[i]=(i*37+case_id*13+seed)^(i>>8)^(seed>>16);
     memory[src+i]=expected[i];
   end
   @(negedge clk);src_addr=src;dst_addr=dst;length=n;tag=case_id;error_mode=err;mode=stalls;req_valid=1;
   do @(posedge clk);while(!req_ready);
   @(negedge clk);req_valid=0;
 end
endtask
task automatic copy_check(input integer src,dst,n,err,stalls,input string family);
 integer i,deadline,written_before;
 begin
   written_before=write_bytes;start_copy(src,dst,n,err,stalls);deadline=cycle+1000000;
   while(!done&&cycle<deadline)@(negedge clk);
   if(!done)$fatal(1,"DMA_TIMEOUT case=%0d",case_id);
   if(done_tag!==tag||done_length!==length||!req_ready)$fatal(1,"DMA_STATUS_MISMATCH case=%0d",case_id);
   if(read_error!==(err==1?4:err==2?5:0)||write_error!==(err==3?6:err==4?7:0))$fatal(1,"DMA_ERROR_CODE case=%0d read=%0d write=%0d",case_id,read_error,write_error);
   if(write_bytes-written_before!=n)$fatal(1,"DMA_WRITE_BYTE_COUNT case=%0d",case_id);
   if(NEGATIVE_CONTROL&&case_id==0)begin memory[dst+n/2]=memory[dst+n/2]^8'h01;$display("NEGATIVE_INJECTION destination_bit_flipped");end
   // Immutable expected bytes avoid accepting matching source/destination corruption.
   // AXI errors retain deterministic payloads in this memory model.
   for(i=0;i<n;i=i+1)begin
     if(memory[dst+i]!==expected[i])$fatal(1,"DMA_DATA case=%0d offset=%0d",case_id,i);
     if(memory[src+i]!==expected[i])$fatal(1,"DMA_SOURCE_CORRUPTION case=%0d offset=%0d",case_id,i);
     byte_checks=byte_checks+1;
   end
   for(i=1;i<=4;i=i+1)if(memory[dst-i]!==8'ha5||memory[dst+n+i-1]!==8'ha5)$fatal(1,"DMA_GUARD_OVERWRITE case=%0d",case_id);
   $display("DMA_CASE_PASS case=%0d family=%s seed=%h src=%h dst=%h length=%0d error_mode=%0d stalls=%0d",case_id,family,seed,src,dst,n,err,stalls);
   case_id=case_id+1;@(negedge clk);
 end
endtask
task automatic abort_and_recover(input integer phase);
 integer deadline,old_wbeats;reg reached;
 begin
   old_wbeats=wbeats;start_copy(16'h0fff,16'h9ffd,8193,0,phase==2?2:1);
   deadline=cycle+100000;reached=0;
   while(!reached&&cycle<deadline)begin
     @(negedge clk);
     case(phase)
       0:reached=ractive;
       1:reached=wbeats>old_wbeats+7;
       2:reached=dut.in_valid&&!dut.in_ready;
     endcase
   end
   if(!reached)$fatal(1,"RESET_PHASE_NOT_REACHED phase=%0d",phase);
   // First FIFO fullness precedes AXI backpressure because the read engine buffers data too.
   if(phase==2)begin
     while(!(m_axi_rvalid&&!m_axi_rready)&&cycle<deadline)@(negedge clk);
     if(!(m_axi_rvalid&&!m_axi_rready))$fatal(1,"RESET_R_BACKPRESSURE_NOT_REACHED");
     repeat(8)@(negedge clk);
   end
   rst=1;repeat(8)@(negedge clk);rst=0;repeat(4)@(negedge clk);
   if(!req_ready||m_axi_awvalid||m_axi_arvalid||m_axi_wvalid||done)$fatal(1,"RESET_NOT_FLUSHED");
   reset_aborts=reset_aborts+1;
   $display("DMA_RESET_ABORT phase=%0d seed=%h",phase,seed);
   copy_check(16'h1001+phase,16'h9003-phase,4097+phase*31,0,1,"reset_recovery");
 end
endtask
integer a,b,k,s,n,src,dst,burst_lengths[0:23];
reg[31:0] seeds[0:3];
initial begin
 seeds[0]=32'hc001cafe;seeds[1]=32'h5eed1234;seeds[2]=32'hdeadbeef;seeds[3]=32'h13579bdf;
 burst_lengths[0]=1;burst_lengths[1]=2;burst_lengths[2]=3;burst_lengths[3]=4;
 burst_lengths[4]=5;burst_lengths[5]=7;burst_lengths[6]=8;burst_lengths[7]=15;
 burst_lengths[8]=16;burst_lengths[9]=17;burst_lengths[10]=31;burst_lengths[11]=32;
 burst_lengths[12]=33;burst_lengths[13]=63;burst_lengths[14]=64;burst_lengths[15]=65;
 burst_lengths[16]=127;burst_lengths[17]=128;burst_lengths[18]=129;burst_lengths[19]=255;
 burst_lengths[20]=256;burst_lengths[21]=257;burst_lengths[22]=511;burst_lengths[23]=513;
 for(n=0;n<65536;n=n+1)memory[n]=0;
 repeat(8)@(negedge clk);rst=0;seed=seeds[0];
 // Exhaustive alignment x length thresholds: 384 distinct descriptors.
 for(a=0;a<4;a=a+1)for(b=0;b<4;b=b+1)for(k=0;k<24;k=k+1)
   copy_check(16'h1000+a,16'h8000+b,burst_lengths[k],0,k%2,"alignment_length");
 // Independent bus/stimulus seeds; random offsets force unequal 4 KiB splits.
 for(s=0;s<4;s=s+1)begin
   seed=seeds[s];rng=seed;vector_rng=seed^32'ha5a5a5a5;
   for(k=0;k<64;k=k+1)begin
     vector_rng=next_vector(vector_rng);src=16'h0100+(vector_rng&8191);
     vector_rng=next_vector(vector_rng);dst=16'h8000+(vector_rng&8191);
     vector_rng=next_vector(vector_rng);n=4097+(vector_rng%12285);
     copy_check(src,dst,n,0,k%8==0?3:1,"seeded_long");
   end
   for(k=0;k<8;k=k+1)copy_check(16'h0ffc+(k%4),16'h9ffc+((k+1)%4),4093+k,0,1,"boundary_4k");
   for(k=1;k<=4;k=k+1)begin
     copy_check(16'h2000+k,16'h9000+((k+1)%4),513+1024*k,k,1,"axi_response_error");
     copy_check(16'h2003,16'ha001,1023+k,0,1,"error_recovery");
   end
   for(k=0;k<3;k=k+1)abort_and_recover(k);
 end
 copy_check(16'h0004,16'h8000,32760,0,1,"maximum_nonoverlap");
 if(byte_checks<2000000||reset_aborts!=12||ar_stalls==0||aw_stalls==0||w_stalls==0||r_stalls==0||axis_stalls==0)$fatal(1,"COVERAGE_NOT_REACHED bytes=%0d resets=%0d ar=%0d aw=%0d w=%0d r=%0d axis=%0d",byte_checks,reset_aborts,ar_stalls,aw_stalls,w_stalls,r_stalls,axis_stalls);
 $display("SYSTEM_BENCH_PASS project=dma scenarios=%0d seeds=4 reset_aborts=%0d byte_checks=%0d read_bursts=%0d write_bursts=%0d read_beats=%0d write_beats=%0d protocol_checks=%0d ar_stalls=%0d aw_stalls=%0d w_stalls=%0d r_stalls=%0d axis_stalls=%0d cycles=%0d",case_id,reset_aborts,byte_checks,ar_count,aw_count,rbeats,wbeats,protocol_checks,ar_stalls,aw_stalls,w_stalls,r_stalls,axis_stalls,cycle);
 $finish;
end
initial begin #1000000000;$fatal(1,"DMA_GLOBAL_TIMEOUT");end
endmodule
