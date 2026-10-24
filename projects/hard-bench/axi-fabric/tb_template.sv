`timescale 1ns/1ps
module tb_axi_fabric #(parameter NEGATIVE_CONTROL=0,TRACE_ONLY=0);
// PORT_DECLARATIONS
reg[14:0] release_mask=0;
axi_fabric_top dut(.*);
always #5 clk=~clk;
reg[7:0] reference_mem[0:32767];
reg[31:0] seeds[0:3],seed=0,rng[0:2],gate_rng=1;
integer phase=0,seed_index=0,cycle=0,nwrite=0,nread=0;
reg active=0,negative_fired=0;
integer aw_seq[0:2],w_seq[0:2],w_beat[0:2],b_done[0:2],ar_seq[0:2],r_done[0:2];
integer b_next[0:2][0:3],r_next[0:2][0:3],r_beat[0:2][0:3];
integer w_id_pending[0:2][0:3],r_id_pending[0:2][0:3];
integer max_write_out[0:2],max_read_out[0:2],max_combined[0:2];
integer total_aw=0,total_b=0,total_ar=0,total_read_bursts=0,total_wbeats=0,total_rbeats=0;
integer byte_writes=0,byte_reads=0,slverr_b=0,decerr_b=0,slverr_r=0,decerr_r=0;
integer max_total_out=0,max_write_id_depth=0,max_read_id_depth=0;
integer simultaneous_master_cycles=0,all_three_active_cycles=0,simultaneous_rw_cycles=0;
integer max_active_masters=0,shared_read_bursts=0,boundary_bursts=0,protocol_checks=0;
integer out_of_order_writes=0,out_of_order_reads=0,w_retire[0:2],r_retire[0:2];
reg write_completed[0:2][0:127],read_completed[0:2][0:127];
integer aw_stalls=0,w_stalls=0,b_stalls=0,ar_stalls=0,r_stalls=0;
integer early_wvalid_cycles=0;
integer w_before_awvalid_cycles=0,target_wlast_checks=0,response_valid_checks=0;
integer route_aw[0:2],route_ar[0:2],seed_completed=0;
reg[2:0] aw_hold=0,w_hold=0,b_hold=0,ar_hold=0,r_hold=0;
reg[40:0] old_aw[0:2],old_ar[0:2];reg[36:0] old_w[0:2];reg[5:0] old_b[0:2];reg[38:0] old_r[0:2];
integer m,id,q,beat,addr,lanes,tmp,tot,participating,write_fire,read_fire;
reg[31:0] data_word,expected_word;
genvar debug_master;
generate for(debug_master=0;debug_master<3;debug_master=debug_master+1)begin:debug_state
 integer remaining=0;
 always @(posedge clk)begin
  if(rst)remaining=0;
  else begin
   if(dut.targets[debug_master].t_awvalid&&dut.targets[debug_master].t_awready)begin
    if(remaining!=0)$fatal(1,"TARGET_WRITE_OVERLAP target=%0d",debug_master);
    remaining=dut.targets[debug_master].t_awlen+1;
   end
   if(dut.targets[debug_master].t_wvalid&&dut.targets[debug_master].t_wready)begin
    if(remaining<=0||dut.targets[debug_master].t_wlast!==(remaining==1))$fatal(1,"TARGET_WLAST target=%0d remaining=%0d",debug_master,remaining);
    remaining=remaining-1;target_wlast_checks=target_wlast_checks+1;
   end
  end
 end
 always @(posedge clk)if(cycle%50000==0&&cycle>0)begin
  $display("FABRIC_DEBUG m=%0d wseq=%0d wbeat=%0d wv=%b wr=%b queued=%0d corebv=%b corebr=%b bid=%0d credits=%0d,%0d,%0d,%0d wc=%b wcv=%b drop=%b select=%0d aw_state=%0d trans=%0d",debug_master,w_seq[debug_master],w_beat[debug_master],s_axi_wvalid[debug_master],s_axi_wready[debug_master],dut.completion_guards[debug_master].guard.queued,dut.core_bvalid[debug_master],dut.core_bready[debug_master],dut.core_bid[debug_master*4+:4],dut.completion_guards[debug_master].guard.completed_data[0],dut.completion_guards[debug_master].guard.completed_data[1],dut.completion_guards[debug_master].guard.completed_data[2],dut.completion_guards[debug_master].guard.completed_data[3],dut.fabric.axi_crossbar_wr_inst.s_ifaces[debug_master].m_wc_ready,dut.fabric.axi_crossbar_wr_inst.s_ifaces[debug_master].m_wc_valid,dut.fabric.axi_crossbar_wr_inst.s_ifaces[debug_master].w_drop_reg,dut.fabric.axi_crossbar_wr_inst.s_ifaces[debug_master].w_select_reg,dut.fabric.axi_crossbar_wr_inst.s_ifaces[debug_master].addr_inst.state_reg,dut.fabric.axi_crossbar_wr_inst.s_ifaces[debug_master].addr_inst.trans_count_reg);
  $display("FABRIC_TARGET t=%0d awv=%b awr=%b wv=%b wr=%b bv=%b br=%b bid=%0d",debug_master,dut.targets[debug_master].t_awvalid,dut.targets[debug_master].t_awready,dut.targets[debug_master].t_wvalid,dut.targets[debug_master].t_wready,dut.targets[debug_master].t_bvalid,dut.targets[debug_master].t_bready,dut.targets[debug_master].t_bid);
 end
end endgenerate
function automatic[31:0] xorshift(input[31:0] value);
 reg[31:0] x;begin x=value^(value<<13);x=x^(x>>17);xorshift=x^(x<<5);end
endfunction
function automatic integer beats_for(input integer p,seq);
 begin
  if(p==1)case(seq%8)0:beats_for=1;1:beats_for=2;2:beats_for=4;3:beats_for=8;4:beats_for=16;5:beats_for=32;6:beats_for=64;7:beats_for=4;endcase
  else beats_for=16;
 end
endfunction
function automatic integer write_id_for(input integer seq);
 begin write_id_for=(seq/2)%4;end
endfunction
function automatic integer address_for(input integer p,master,seq,wr);
 integer target,offset,n,owner;
 begin
  n=beats_for(p,seq);
  if(p==0)begin target=seq/32;offset=master*4096+(seq%32)*64;end
  else if(p==1)begin
   target=(seq/8+master)%4;
   offset=master*4096+(wr?2048:0)+((seq*137+master*41+(seed&255))%(512-n+1))*4;
   if(seq%5==0)offset=master*4096+(wr?4096:2048)-n*4;
  end else if(p==2)begin target=seq/32;offset=master*4096+2048+(seq%32)*64;end
  else begin target=seq;owner=p==3?master:(master+1)%3;offset=16'h3000+owner*128;end
  address_for=target*16384+offset;
 end
endfunction
function automatic[31:0] write_value(input integer p,master,seq,beat_no);
 begin write_value=xorshift(seed^(master*32'h10203041)^(p*32'h91e10da5)^(seq*32'h45d9f3b)^(beat_no*32'h9e3779b9));end
endfunction
function automatic[3:0] strobes(input integer p,master,seq,beat_no);
 begin strobes=p==1?1+((seq+beat_no*3+master+(seed&15))%15):15;end
endfunction
function automatic[1:0] response_for(input integer p,master,seq,wr);
 integer a;begin a=address_for(p,master,seq,wr);response_for=a>=49152?3:a>=32768?2:0;end
endfunction
// Sources only present a new VALID on negedge; posedge handshakes retire it.
always @(negedge clk)begin
 gate_rng=xorshift(gate_rng);release_mask=gate_rng[14:0];
 for(integer j=0;j<3;j=j+1)begin
  rng[j]=xorshift(rng[j]);
  s_axi_bready[j]=active&&!rst&&(rng[j][3]||rng[j][4]);
  s_axi_rready[j]=active&&!rst&&rng[j][5];
  if(active&&!rst)begin
   if(!s_axi_awvalid[j]&&aw_seq[j]<nwrite&&aw_seq[j]-b_done[j]<8&&rng[j][0])begin
    s_axi_awid[j*4+:4]=write_id_for(aw_seq[j]);
    s_axi_awaddr[j*16+:16]=address_for(phase,j,aw_seq[j],1);
    s_axi_awlen[j*8+:8]=beats_for(phase,aw_seq[j])-1;
    s_axi_awsize[j*3+:3]=2;s_axi_awburst[j*2+:2]=1;s_axi_awvalid[j]=1;
   end
   if(!s_axi_wvalid[j]&&w_seq[j]<nwrite&&rng[j][1])begin
    s_axi_wdata[j*32+:32]=write_value(phase,j,w_seq[j],w_beat[j]);
    s_axi_wstrb[j*4+:4]=strobes(phase,j,w_seq[j],w_beat[j]);
    s_axi_wlast[j]=w_beat[j]==beats_for(phase,w_seq[j])-1;s_axi_wvalid[j]=1;
   end
   if(!s_axi_arvalid[j]&&ar_seq[j]<nread&&ar_seq[j]-r_done[j]<8&&rng[j][2])begin
    s_axi_arid[j*4+:4]=ar_seq[j]%4;
    s_axi_araddr[j*16+:16]=address_for(phase,j,ar_seq[j],0);
    s_axi_arlen[j*8+:8]=beats_for(phase,ar_seq[j])-1;
    s_axi_arsize[j*3+:3]=2;s_axi_arburst[j*2+:2]=1;s_axi_arvalid[j]=1;
   end
  end
 end
end
always @(posedge clk)begin
 cycle=cycle+1;
 if(cycle%50000==0)$display("FABRIC_HEARTBEAT cycle=%0d seed=%h phase=%0d aw=%0d,%0d,%0d b=%0d,%0d,%0d ar=%0d,%0d,%0d r=%0d,%0d,%0d",cycle,seed,phase,aw_seq[0],aw_seq[1],aw_seq[2],b_done[0],b_done[1],b_done[2],ar_seq[0],ar_seq[1],ar_seq[2],r_done[0],r_done[1],r_done[2]);
 if(cycle>6000000)$fatal(1,"FABRIC_TIMEOUT phase=%0d aw=%0d,%0d,%0d b=%0d,%0d,%0d ar=%0d,%0d,%0d rd=%0d,%0d,%0d",phase,aw_seq[0],aw_seq[1],aw_seq[2],b_done[0],b_done[1],b_done[2],ar_seq[0],ar_seq[1],ar_seq[2],r_done[0],r_done[1],r_done[2]);
 if(rst)begin aw_hold=0;w_hold=0;b_hold=0;ar_hold=0;r_hold=0;end
 else if(active)begin
  participating=0;write_fire=0;read_fire=0;tot=0;
  for(m=0;m<3;m=m+1)begin
   if(s_axi_wvalid[m]&&w_seq[m]>=aw_seq[m])early_wvalid_cycles=early_wvalid_cycles+1;
   if(s_axi_wvalid[m]&&w_seq[m]>=aw_seq[m]&&!s_axi_awvalid[m])w_before_awvalid_cycles=w_before_awvalid_cycles+1;
   if(s_axi_bvalid[m])begin
    id=s_axi_bid[m*4+:4];
    if(id>=4)$fatal(1,"BVALID_BAD_ID");
    q=b_next[m][id];
    if(q>=aw_seq[m]||q>=w_seq[m]||w_id_pending[m][id]<=0)$fatal(1,"BVALID_BEFORE_AW_WLAST master=%0d id=%0d seq=%0d",m,id,q);
    response_valid_checks=response_valid_checks+1;
   end
   if(s_axi_rvalid[m])begin
    id=s_axi_rid[m*4+:4];
    if(id>=4)$fatal(1,"RVALID_BAD_ID");
    if(r_next[m][id]>=ar_seq[m]||r_id_pending[m][id]<=0)$fatal(1,"RVALID_BEFORE_AR");
    response_valid_checks=response_valid_checks+1;
   end
   if(aw_hold[m]&&(!s_axi_awvalid[m]||{s_axi_awid[m*4+:4],s_axi_awaddr[m*16+:16],s_axi_awlen[m*8+:8],s_axi_awsize[m*3+:3],s_axi_awburst[m*2+:2],s_axi_awlock[m],s_axi_awcache[m*4+:4],s_axi_awprot[m*3+:3]}!==old_aw[m]))$fatal(1,"AW_UNSTABLE");
   if(w_hold[m]&&(!s_axi_wvalid[m]||{s_axi_wdata[m*32+:32],s_axi_wstrb[m*4+:4],s_axi_wlast[m]}!==old_w[m]))$fatal(1,"W_UNSTABLE");
   if(b_hold[m]&&(!s_axi_bvalid[m]||{s_axi_bid[m*4+:4],s_axi_bresp[m*2+:2]}!==old_b[m]))$fatal(1,"B_UNSTABLE");
   if(ar_hold[m]&&(!s_axi_arvalid[m]||{s_axi_arid[m*4+:4],s_axi_araddr[m*16+:16],s_axi_arlen[m*8+:8],s_axi_arsize[m*3+:3],s_axi_arburst[m*2+:2],s_axi_arlock[m],s_axi_arcache[m*4+:4],s_axi_arprot[m*3+:3]}!==old_ar[m]))$fatal(1,"AR_UNSTABLE");
   if(r_hold[m]&&(!s_axi_rvalid[m]||{s_axi_rid[m*4+:4],s_axi_rdata[m*32+:32],s_axi_rresp[m*2+:2],s_axi_rlast[m]}!==old_r[m]))$fatal(1,"R_UNSTABLE");
   protocol_checks=protocol_checks+aw_hold[m]+w_hold[m]+b_hold[m]+ar_hold[m]+r_hold[m];
   aw_stalls=aw_stalls+aw_hold[m];w_stalls=w_stalls+w_hold[m];b_stalls=b_stalls+b_hold[m];ar_stalls=ar_stalls+ar_hold[m];r_stalls=r_stalls+r_hold[m];
   aw_hold[m]=s_axi_awvalid[m]&&!s_axi_awready[m];w_hold[m]=s_axi_wvalid[m]&&!s_axi_wready[m];b_hold[m]=s_axi_bvalid[m]&&!s_axi_bready[m];ar_hold[m]=s_axi_arvalid[m]&&!s_axi_arready[m];r_hold[m]=s_axi_rvalid[m]&&!s_axi_rready[m];
   old_aw[m]={s_axi_awid[m*4+:4],s_axi_awaddr[m*16+:16],s_axi_awlen[m*8+:8],s_axi_awsize[m*3+:3],s_axi_awburst[m*2+:2],s_axi_awlock[m],s_axi_awcache[m*4+:4],s_axi_awprot[m*3+:3]};
   old_w[m]={s_axi_wdata[m*32+:32],s_axi_wstrb[m*4+:4],s_axi_wlast[m]};old_b[m]={s_axi_bid[m*4+:4],s_axi_bresp[m*2+:2]};
   old_ar[m]={s_axi_arid[m*4+:4],s_axi_araddr[m*16+:16],s_axi_arlen[m*8+:8],s_axi_arsize[m*3+:3],s_axi_arburst[m*2+:2],s_axi_arlock[m],s_axi_arcache[m*4+:4],s_axi_arprot[m*3+:3]};
   old_r[m]={s_axi_rid[m*4+:4],s_axi_rdata[m*32+:32],s_axi_rresp[m*2+:2],s_axi_rlast[m]};
   if((s_axi_awvalid[m]&&s_axi_awready[m])||(s_axi_wvalid[m]&&s_axi_wready[m])||(s_axi_bvalid[m]&&s_axi_bready[m])||(s_axi_arvalid[m]&&s_axi_arready[m])||(s_axi_rvalid[m]&&s_axi_rready[m]))participating=participating+1;
   if(s_axi_awvalid[m]&&s_axi_awready[m])begin
    addr=address_for(phase,m,aw_seq[m],1);tmp=beats_for(phase,aw_seq[m])*4;
    if((addr&4095)+tmp>4096)$fatal(1,"ILLEGAL_WRITE_4K");
    if((addr&4095)+tmp==4096)boundary_bursts=boundary_bursts+1;
    id=write_id_for(aw_seq[m]);w_id_pending[m][id]=w_id_pending[m][id]+1;
    if(w_id_pending[m][id]>max_write_id_depth)max_write_id_depth=w_id_pending[m][id];
    aw_seq[m]=aw_seq[m]+1;total_aw=total_aw+1;s_axi_awvalid[m]<=0;
   end
   if(s_axi_wvalid[m]&&s_axi_wready[m])begin
    write_fire=1;addr=address_for(phase,m,w_seq[m],1)+w_beat[m]*4;
    if(addr<32768)for(lanes=0;lanes<4;lanes=lanes+1)if(s_axi_wstrb[m*4+lanes])begin
     reference_mem[addr+lanes]=s_axi_wdata[m*32+lanes*8+:8];byte_writes=byte_writes+1;
    end
    total_wbeats=total_wbeats+1;
    if(s_axi_wlast[m])begin w_seq[m]=w_seq[m]+1;w_beat[m]=0;end else w_beat[m]=w_beat[m]+1;
    s_axi_wvalid[m]<=0;
   end
   if(s_axi_bvalid[m]&&s_axi_bready[m])begin
    id=s_axi_bid[m*4+:4];if(id>=4)$fatal(1,"BID_ROUTING master=%0d id=%0d",m,id);
    q=b_next[m][id];if(q>=aw_seq[m]||q>=w_seq[m]||w_id_pending[m][id]<=0)$fatal(1,"UNEXPECTED_B_RESPONSE master=%0d phase=%0d id=%0d seq=%0d aw_seq=%0d w_seq=%0d pending=%0d resp=%0d",m,phase,id,q,aw_seq[m],w_seq[m],w_id_pending[m][id],s_axi_bresp[m*2+:2]);
    if(s_axi_bresp[m*2+:2]!==response_for(phase,m,q,1))$fatal(1,"BRESP_MISMATCH master=%0d seq=%0d",m,q);
    if(q!=w_retire[m])out_of_order_writes=out_of_order_writes+1;
    write_completed[m][q]=1;
    while(w_retire[m]<nwrite&&write_completed[m][w_retire[m]])w_retire[m]=w_retire[m]+1;
    if(s_axi_bresp[m*2+:2]==2)slverr_b=slverr_b+1;if(s_axi_bresp[m*2+:2]==3)decerr_b=decerr_b+1;
    b_next[m][id]=q+(q%2==0?1:7);w_id_pending[m][id]=w_id_pending[m][id]-1;b_done[m]=b_done[m]+1;total_b=total_b+1;
   end
   if(s_axi_arvalid[m]&&s_axi_arready[m])begin
    addr=address_for(phase,m,ar_seq[m],0);tmp=beats_for(phase,ar_seq[m])*4;
    if((addr&4095)+tmp>4096)$fatal(1,"ILLEGAL_READ_4K");
    if((addr&4095)+tmp==4096)boundary_bursts=boundary_bursts+1;
    id=ar_seq[m]%4;r_id_pending[m][id]=r_id_pending[m][id]+1;
    if(r_id_pending[m][id]>max_read_id_depth)max_read_id_depth=r_id_pending[m][id];
    ar_seq[m]=ar_seq[m]+1;total_ar=total_ar+1;s_axi_arvalid[m]<=0;
   end
   if(s_axi_rvalid[m]&&s_axi_rready[m])begin
    read_fire=1;id=s_axi_rid[m*4+:4];if(id>=4)$fatal(1,"RID_ROUTING master=%0d id=%0d",m,id);
    q=r_next[m][id];beat=r_beat[m][id];
    if(q>=ar_seq[m]||r_id_pending[m][id]<=0)$fatal(1,"UNEXPECTED_R_RESPONSE");
    if(s_axi_rresp[m*2+:2]!==response_for(phase,m,q,0))$fatal(1,"RRESP_MISMATCH master=%0d phase=%0d id=%0d seq=%0d beat=%0d expected=%0d actual=%0d accepted_ar=%0d",m,phase,id,q,beat,response_for(phase,m,q,0),s_axi_rresp[m*2+:2],ar_seq[m]);
    if(s_axi_rlast[m] !== (beat==beats_for(phase,q)-1))$fatal(1,"RLAST_ORDER_MISMATCH master=%0d id=%0d seq=%0d beat=%0d",m,id,q,beat);
    addr=address_for(phase,m,q,0)+beat*4;data_word=s_axi_rdata[m*32+:32];
    if(addr<32768)begin
     expected_word={reference_mem[addr+3],reference_mem[addr+2],reference_mem[addr+1],reference_mem[addr]};
     if(NEGATIVE_CONTROL&&!negative_fired)begin data_word=data_word^32'h1;negative_fired=1;$display("FABRIC_NEGATIVE_INJECTION one_read_data_bit");end
     if(data_word!==expected_word)$fatal(1,"FABRIC_READ_DATA master=%0d phase=%0d seq=%0d beat=%0d addr=%h got=%h expected=%h",m,phase,q,beat,addr,data_word,expected_word);
     byte_reads=byte_reads+4;
    end
    total_rbeats=total_rbeats+1;
    if(s_axi_rlast[m])begin
     if(q!=r_retire[m])out_of_order_reads=out_of_order_reads+1;
     read_completed[m][q]=1;
     while(r_retire[m]<nread&&read_completed[m][r_retire[m]])r_retire[m]=r_retire[m]+1;
     if(s_axi_rresp[m*2+:2]==2)slverr_r=slverr_r+1;if(s_axi_rresp[m*2+:2]==3)decerr_r=decerr_r+1;
     r_next[m][id]=q+4;r_beat[m][id]=0;r_id_pending[m][id]=r_id_pending[m][id]-1;r_done[m]=r_done[m]+1;total_read_bursts=total_read_bursts+1;
     if(phase==4)shared_read_bursts=shared_read_bursts+1;
    end else r_beat[m][id]=beat+1;
   end
   tmp=aw_seq[m]-b_done[m];if(tmp>max_write_out[m])max_write_out[m]=tmp;
   tmp=ar_seq[m]-r_done[m];if(tmp>max_read_out[m])max_read_out[m]=tmp;
   tmp=aw_seq[m]-b_done[m]+ar_seq[m]-r_done[m];if(tmp>max_combined[m])max_combined[m]=tmp;tot=tot+tmp;
   if(dut.m_axi_awvalid[m]&&dut.m_axi_awready[m])begin
    if(dut.m_axi_awid[m*6+4+:2]>2)$fatal(1,"TARGET_AW_ID_PREFIX");route_aw[m]=route_aw[m]+1;
   end
   if(dut.m_axi_arvalid[m]&&dut.m_axi_arready[m])begin
    if(dut.m_axi_arid[m*6+4+:2]>2)$fatal(1,"TARGET_AR_ID_PREFIX");route_ar[m]=route_ar[m]+1;
   end
  end
  if(tot>max_total_out)max_total_out=tot;
  if(participating>max_active_masters)max_active_masters=participating;
  if(participating>=2)simultaneous_master_cycles=simultaneous_master_cycles+1;
  if(participating==3)all_three_active_cycles=all_three_active_cycles+1;
  if(write_fire&&read_fire)simultaneous_rw_cycles=simultaneous_rw_cycles+1;
 end
end
task automatic run_phase(input integer p,wr_count,rd_count);
 integer i,k,deadline;reg complete;
 begin
  @(negedge clk);active=0;phase=p;nwrite=wr_count;nread=rd_count;
  s_axi_awvalid=0;s_axi_wvalid=0;s_axi_arvalid=0;
  for(i=0;i<3;i=i+1)begin
   aw_seq[i]=0;w_seq[i]=0;w_beat[i]=0;b_done[i]=0;ar_seq[i]=0;r_done[i]=0;
   w_retire[i]=0;r_retire[i]=0;
   for(k=0;k<128;k=k+1)begin write_completed[i][k]=0;read_completed[i][k]=0;end
   for(k=0;k<4;k=k+1)begin b_next[i][k]=2*k;r_next[i][k]=k;r_beat[i][k]=0;w_id_pending[i][k]=0;r_id_pending[i][k]=0;end
  end
  active=1;complete=0;deadline=cycle+200000;
  while(!complete)begin
   @(negedge clk);complete=1;
   if(cycle>deadline)$fatal(1,"PHASE_PROGRESS_TIMEOUT phase=%0d",p);
   for(i=0;i<3;i=i+1)if(b_done[i]!=wr_count||r_done[i]!=rd_count)complete=0;
  end
  active=0;repeat(6)@(negedge clk);
  if(s_axi_bvalid||s_axi_rvalid)$fatal(1,"EXTRA_RESPONSE_AFTER_DRAIN");
  $display("FABRIC_PHASE_PASS seed=%h phase=%0d writes=%0d reads=%0d",seed,p,3*wr_count,3*rd_count);
 end
endtask
integer init_i;
initial begin
 seeds[0]=32'hc001cafe;seeds[1]=32'h5eed1234;seeds[2]=32'hdeadbeef;seeds[3]=32'h13579bdf;
 for(init_i=0;init_i<32768;init_i=init_i+1)reference_mem[init_i]=0;
 for(init_i=0;init_i<3;init_i=init_i+1)begin max_write_out[init_i]=0;max_read_out[init_i]=0;max_combined[init_i]=0;route_aw[init_i]=0;route_ar[init_i]=0;rng[init_i]=init_i+1;end
 for(seed_index=0;seed_index<(TRACE_ONLY?1:4);seed_index=seed_index+1)begin
  @(negedge clk);active=0;rst=1;seed=seeds[seed_index];gate_rng=seed^32'habcdef01;
  for(init_i=0;init_i<3;init_i=init_i+1)rng[init_i]=seed^(init_i*32'h1234567);
  repeat(8)@(negedge clk);rst=0;
  run_phase(0,64,0);run_phase(1,TRACE_ONLY?16:128,TRACE_ONLY?16:128);run_phase(2,0,64);
  run_phase(3,2,0);run_phase(4,0,2);seed_completed=seed_completed+1;
 end
 if(TRACE_ONLY)begin $display("HARD_BENCH_TRACE_PASS project=axi_fabric write_bursts=%0d read_bursts=%0d cycles=%0d",total_aw,total_ar,cycle);$finish;end
 if(total_aw!=2328||total_b!=2328||total_ar!=2328||total_read_bursts!=2328)$fatal(1,"BURST_ACCOUNTING");
 if(slverr_b!=384||decerr_b!=384||slverr_r!=384||decerr_r!=384)$fatal(1,"ERROR_ACCOUNTING");
 if(max_active_masters!=3||simultaneous_master_cycles<100||all_three_active_cycles<10||simultaneous_rw_cycles<100||max_total_out<12||max_write_id_depth<2||max_read_id_depth<2||out_of_order_reads==0)$fatal(1,"CONCURRENCY_COVERAGE max_total=%0d same_wid=%0d same_rid=%0d out_of_order_reads=%0d",max_total_out,max_write_id_depth,max_read_id_depth,out_of_order_reads);
 if(shared_read_bursts!=24||boundary_bursts==0||aw_stalls==0||w_stalls==0||b_stalls==0||ar_stalls==0||r_stalls==0||early_wvalid_cycles==0||w_before_awvalid_cycles==0)$fatal(1,"FABRIC_COVERAGE");
 for(init_i=0;init_i<3;init_i=init_i+1)begin
  if(max_write_out[init_i]<2||max_read_out[init_i]<2||route_aw[init_i]==0||route_ar[init_i]==0)$fatal(1,"MASTER_TARGET_COVERAGE");
  $display("FABRIC_MASTER_METRICS master=%0d max_write_outstanding=%0d max_read_outstanding=%0d max_combined=%0d target_writes=%0d target_reads=%0d",init_i,max_write_out[init_i],max_read_out[init_i],max_combined[init_i],route_aw[init_i],route_ar[init_i]);
 end
 $display("FABRIC_ORDER_METRICS out_of_order_write_completions=%0d out_of_order_read_completions=%0d early_wvalid_cycles=%0d w_before_awvalid_cycles=%0d target_wlast_checks=%0d response_valid_checks=%0d",out_of_order_writes,out_of_order_reads,early_wvalid_cycles,w_before_awvalid_cycles,target_wlast_checks,response_valid_checks);
 $display("HARD_BENCH_PASS project=axi_fabric seeds=%0d write_bursts=%0d read_bursts=%0d write_beats=%0d read_beats=%0d bytes_written=%0d bytes_read_checked=%0d slverr_writes=%0d decerr_writes=%0d slverr_reads=%0d decerr_reads=%0d max_total_outstanding=%0d same_write_id_depth=%0d same_read_id_depth=%0d simultaneous_master_cycles=%0d all_three_active_cycles=%0d simultaneous_rw_cycles=%0d shared_read_bursts=%0d boundary_bursts=%0d protocol_checks=%0d aw_stalls=%0d w_stalls=%0d b_stalls=%0d ar_stalls=%0d r_stalls=%0d cycles=%0d",seed_completed,total_aw,total_ar,total_wbeats,total_rbeats,byte_writes,byte_reads,slverr_b,decerr_b,slverr_r,decerr_r,max_total_out,max_write_id_depth,max_read_id_depth,simultaneous_master_cycles,all_three_active_cycles,simultaneous_rw_cycles,shared_read_bursts,boundary_bursts,protocol_checks,aw_stalls,w_stalls,b_stalls,ar_stalls,r_stalls,cycle);
 $finish;
end
endmodule
