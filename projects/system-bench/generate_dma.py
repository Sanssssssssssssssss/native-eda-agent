"""Generate explicit port wiring; behavioral tests live in a separate source."""
import json,pathlib,re
from prepare import ROOT,HERE,prepare
d=HERE/'dma';d.mkdir(exist_ok=True)
source=(ROOT/'vendor/verilog-axi/rtl/axi_dma.v').read_text()
head=source[:source.index('\n);')]
params={'AXI_DATA_WIDTH':32,'AXI_ADDR_WIDTH':16,'AXI_STRB_WIDTH':4,'AXI_ID_WIDTH':4,
'AXIS_DATA_WIDTH':32,'AXIS_KEEP_WIDTH':4,'AXIS_ID_WIDTH':8,'AXIS_DEST_WIDTH':8,'AXIS_USER_WIDTH':1,'LEN_WIDTH':16,'TAG_WIDTH':8}
ports=[]
for direction,width,name in re.findall(r'\b(input|output)\s+wire\s*(\[[^\]]+\])?\s*(\w+)\s*(?:,|\n|$)',head):
    for k,v in params.items():width=width.replace(k,str(v))
    ports.append((direction,width,name))
axi=[p for p in ports if p[2].startswith('m_axi_')]
front='''input wire clk,input wire rst,
 input wire req_valid,output wire req_ready,
 input wire [15:0] src_addr,dst_addr,length,input wire[7:0] tag,
 output reg done,output reg[3:0] read_error,write_error,
 output reg[7:0] done_tag,output reg[15:0] done_length,
'''
body='''
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
'''
mapping={
's_axis_read_desc_addr':'src_reg','s_axis_read_desc_len':'len_reg','s_axis_read_desc_tag':'tag_reg',
's_axis_read_desc_id':"8'b0",'s_axis_read_desc_dest':"8'b0",'s_axis_read_desc_user':"1'b0",
's_axis_read_desc_valid':'rd_pending','s_axis_read_desc_ready':'rd_ready',
'm_axis_read_desc_status_tag':'rd_tag','m_axis_read_desc_status_error':'rd_error','m_axis_read_desc_status_valid':'rd_status',
's_axis_write_desc_addr':'dst_reg','s_axis_write_desc_len':'len_reg','s_axis_write_desc_tag':'tag_reg',
's_axis_write_desc_valid':'wr_pending','s_axis_write_desc_ready':'wr_ready',
'm_axis_write_desc_status_len':'wr_len','m_axis_write_desc_status_tag':'wr_tag','m_axis_write_desc_status_error':'wr_error','m_axis_write_desc_status_valid':'wr_status',
's_axis_write_data_tid':"8'b0",'s_axis_write_data_tdest':"8'b0",'s_axis_write_data_tuser':"1'b0",
'read_enable':"1'b1",'write_enable':"1'b1",'write_abort':"1'b0"}
for suffix in ('data','keep','valid','ready','last'):
    mapping['m_axis_read_data_t'+suffix]='in_'+suffix
    mapping['s_axis_write_data_t'+suffix]='out_'+suffix
connections=[]
for direction,width,name in ports:
    value=name if name in ('clk','rst') or name.startswith('m_axi_') else mapping.get(name,'')
    assert value or direction=='output',name
    connections.append(f'.{name}({value})')
params.update(AXI_MAX_BURST_LEN=16,ENABLE_UNALIGNED=1,AXIS_ID_ENABLE=0,AXIS_DEST_ENABLE=0,AXIS_USER_ENABLE=0)
rtl='`timescale 1ns/1ps\nmodule dma_top(\n'+front+',\n'.join(' '.join((a,'wire',b,c)) for a,b,c in axi)+'\n);\n'+body
rtl+='axi_dma #(\n'+',\n'.join(f'.{k}({v})' for k,v in params.items())+') dma (\n'+',\n'.join(connections)+');\nendmodule\n'
(d/'dma_top.v').write_text(rtl)
decl='\n'.join(('reg' if a=='input' else 'wire')+' '+b+' '+c+('=0' if a=='input' else '')+';' for a,b,c in axi)
(d/'axi-declarations.sv').write_text(decl)
template=(d/'tb_template.sv').read_text()
(d/'tb_dma.sv').write_text(template.replace('// AXI_DECLARATIONS',decl))
prepare('dma','dma_top',['vendor/verilog-axi/rtl/axi_dma.v','vendor/verilog-axi/rtl/axi_dma_rd.v','vendor/verilog-axi/rtl/axi_dma_wr.v','vendor/verilog-ethernet/lib/axis/rtl/axis_fifo.v','projects/system-bench/dma/dma_top.v'])
(d/'tb_dma_negative.sv').write_text('module tb_dma_negative; tb_dma #(.NEGATIVE_CONTROL(1)) test(); endmodule\n')
negative=json.loads((d/'sim.json').read_text())
negative['top']='tb_dma_negative'
negative['sources'].append('projects/system-bench/dma/tb_dma_negative.sv')
(d/'negative.json').write_text(json.dumps(negative,indent=2))
