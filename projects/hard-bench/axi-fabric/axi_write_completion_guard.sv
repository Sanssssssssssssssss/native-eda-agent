`timescale 1ns/1ps
// The pinned crossbar can present DECERR before the corresponding AW/W finish.
// Record accepted AW order, then release B only after that ID has completed WLAST.
module axi_write_completion_guard(
 input wire clk,rst,input wire[3:0] awid,input wire s_awvalid,
 output wire s_awready,output wire m_awvalid,input wire m_awready,output wire write_data_allowed,
 input wire wlast_fire,input wire[3:0] bid,input wire s_bvalid,
 output wire s_bready,output wire m_bvalid,input wire m_bready);
 reg[3:0] ids[0:15];reg[3:0] wr_ptr=0,rd_ptr=0;reg[4:0] queued=0;
 reg[4:0] completed_data[0:15];
 wire aw_fire=s_awvalid&&s_awready;
 wire[3:0] finish_id=queued!=0?ids[rd_ptr]:awid;
 wire b_fire=m_bvalid&&m_bready;
 assign m_awvalid=s_awvalid&&queued!=16&&!rst;
 assign s_awready=m_awready&&queued!=16&&!rst;
 assign write_data_allowed=queued!=0&&!rst;
 assign m_bvalid=s_bvalid&&completed_data[bid]!=0&&!rst;
 assign s_bready=m_bready&&completed_data[bid]!=0&&!rst;
 integer i;
 always @(posedge clk)begin
  if(rst)begin wr_ptr<=0;rd_ptr<=0;queued<=0;for(i=0;i<16;i=i+1)completed_data[i]<=0;end
  else begin
   case({aw_fire,wlast_fire})2'b10:queued<=queued+1'b1;2'b01:queued<=queued-1'b1;default:;endcase
   if(aw_fire)begin ids[wr_ptr]<=awid;wr_ptr<=wr_ptr+1'b1;end
   if(wlast_fire)rd_ptr<=rd_ptr+1'b1;
   for(i=0;i<16;i=i+1)begin
    case({wlast_fire&&finish_id==i,b_fire&&bid==i})
     2'b10:completed_data[i]<=completed_data[i]+1'b1;
     2'b01:completed_data[i]<=completed_data[i]-1'b1;
     default:;
    endcase
   end
  end
 end
endmodule
