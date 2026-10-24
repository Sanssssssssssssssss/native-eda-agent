"""Explicit 3x3 AXI4 fabric wiring. No provider or agent calls."""
import difflib,hashlib,json,pathlib,re
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
raw=(ROOT/'vendor/verilog-axi/rtl/axi_crossbar.v').read_text()
header=raw[:raw.index('\n);')]
params={'S_COUNT':3,'M_COUNT':3,'DATA_WIDTH':32,'ADDR_WIDTH':16,'STRB_WIDTH':4,
        'S_ID_WIDTH':4,'M_ID_WIDTH':6,'AWUSER_WIDTH':1,'WUSER_WIDTH':1,
        'BUSER_WIDTH':1,'ARUSER_WIDTH':1,'RUSER_WIDTH':1}
ports=[]
for direction,width,name in re.findall(r'\b(input|output)\s+wire\s*(\[[^\]]+\])?\s*(\w+)\s*(?:,|\n|$)',header):
    for key in sorted(params,key=len,reverse=True):width=re.sub(r'\b'+key+r'\b',str(params[key]),width)
    ports.append((direction,width,name))
assert len(ports)==88,len(ports)
front=[p for p in ports if not p[2].startswith('m_axi_')]
top='`timescale 1ns/1ps\nmodule axi_fabric_top(\n'+',\n'.join(f'{d} wire {w} {n}' for d,w,n in front)+',\ninput wire[14:0] release_mask\n);\n'
top+='\n'.join(f'wire {w} {n};' for d,w,n in ports if n.startswith('m_axi_'))+'\n'
top+='wire[2:0] guard_awvalid,guard_awready,core_bvalid,core_bready,core_buser,core_wvalid,core_wready,write_data_allowed;wire[11:0] core_bid;wire[5:0] core_bresp;\n'
top+='assign core_wvalid=s_axi_wvalid & write_data_allowed;assign s_axi_wready=core_wready & write_data_allowed;\n'
top+='assign s_axi_bid=core_bid;assign s_axi_bresp=core_bresp;assign s_axi_buser=core_buser;\n'
top+='''genvar guard_index;generate for(guard_index=0;guard_index<3;guard_index=guard_index+1)begin:completion_guards
axi_write_completion_guard guard(.clk(clk),.rst(rst),.awid(s_axi_awid[guard_index*4+:4]),
 .s_awvalid(s_axi_awvalid[guard_index]),.s_awready(s_axi_awready[guard_index]),
 .m_awvalid(guard_awvalid[guard_index]),.m_awready(guard_awready[guard_index]),
 .write_data_allowed(write_data_allowed[guard_index]),
 .wlast_fire(s_axi_wvalid[guard_index]&&s_axi_wready[guard_index]&&s_axi_wlast[guard_index]),
 .bid(core_bid[guard_index*4+:4]),.s_bvalid(core_bvalid[guard_index]),.s_bready(core_bready[guard_index]),
 .m_bvalid(s_axi_bvalid[guard_index]),.m_bready(s_axi_bready[guard_index]));
end endgenerate
'''
settings={**params,'S_THREADS':"{3{32'd4}}",'S_ACCEPT':"{3{32'd8}}",'M_ISSUE':"{3{32'd8}}",
          'M_BASE_ADDR':"{16'h8000,16'h4000,16'h0000}",'M_ADDR_WIDTH':"{3{32'd14}}"}
renames={'s_axi_awvalid':'guard_awvalid','s_axi_awready':'guard_awready',
         's_axi_wvalid':'core_wvalid','s_axi_wready':'core_wready',
         's_axi_bid':'core_bid','s_axi_bresp':'core_bresp','s_axi_buser':'core_buser',
         's_axi_bvalid':'core_bvalid','s_axi_bready':'core_bready'}
top+='axi_crossbar #(\n'+',\n'.join(f'.{k}({v})' for k,v in settings.items())+') fabric(\n'+',\n'.join(f'.{n}({renames.get(n,n)})' for d,w,n in ports)+');\n'
# Local target wires use the axi_ram signal set; QoS, region and USER are disabled/unused.
ram=(ROOT/'vendor/verilog-axi/rtl/axi_ram.v').read_text().split('\n);')[0]
rports=[]
for d,w,n in re.findall(r'\b(input|output)\s+wire\s*(\[[^\]]+\])?\s*(\w+)\s*(?:,|\n|$)',ram):
    for k,v in {'DATA_WIDTH':32,'ADDR_WIDTH':14,'STRB_WIDTH':4,'ID_WIDTH':6}.items():w=w.replace(k,str(v))
    rports.append((d,w,n))
top+='genvar g;generate for(g=0;g<3;g=g+1)begin:targets\n'
top+='\n'.join(f'wire {w} t_{n[6:]};' for d,w,n in rports if n.startswith('s_axi_'))+'\n'
sizes={'id':6,'addr':16,'len':8,'size':3,'burst':2,'lock':1,'cache':4,'prot':3,'data':32,'strb':4,'last':1,'resp':2}
channels=[('aw',['id','addr','len','size','burst','lock','cache','prot'],False),
          ('w',['data','strb','last'],False),('b',['id','resp'],True),
          ('ar',['id','addr','len','size','burst','lock','cache','prot'],False),
          ('r',['id','data','resp','last'],True)]
for index,(channel,fields,reverse) in enumerate(channels):
    width=sum(sizes[f] for f in fields)
    source=[];dest=[]
    for f in fields:
        n=channel+f;w=sizes[f]
        source.append(f'm_axi_{n}[g*{w}+:{w}]')
        # The address decoder selected the 16 KiB window; RAM uses its low 14 bits.
        if f=='addr':
            top+=f'wire[15:0] t_{n}_full;assign t_{n}=t_{n}_full[13:0];\n'
            dest.append(f't_{n}_full')
        else:dest.append(f't_{n}')
    x='{'+','.join(source)+'}';y='{'+','.join(dest)+'}'
    sv=f'm_axi_{channel}valid[g]';sr=f'm_axi_{channel}ready[g]';mv=f't_{channel}valid';mr=f't_{channel}ready'
    if reverse:x,y,sv,sr,mv,mr=y,x,mv,mr,sv,sr
    top+=f'rv_delay #(.WIDTH({width})) delay_{channel}(.clk(clk),.rst(rst),.permit(release_mask[g*5+{index}]),.s_data({x}),.s_valid({sv}),.s_ready({sr}),.m_data({y}),.m_valid({mv}),.m_ready({mr}));\n'
top+='assign m_axi_buser[g]=0;assign m_axi_ruser[g]=0;\n'
for target,condition in [('axi_ram','g<2'),('axi_error_target','')]:
    top+=('if(g<2)begin:ram\n' if condition else 'end else begin:error_target\n')
    arguments='.DATA_WIDTH(32),.ADDR_WIDTH(14),.STRB_WIDTH(4),.ID_WIDTH(6)'
    if condition:arguments+=',.PIPELINE_OUTPUT(1)'
    top+=target+' #('+arguments+') target(\n'+',\n'.join(f'.{n}({n if n in ("clk","rst") else "t_"+n[6:]})' for d,w,n in rports)+');\n'
top+='end\nend endgenerate\nendmodule\n'
(HERE/'axi_fabric_top.sv').write_text(top)
error='`timescale 1ns/1ps\nmodule axi_error_target #(parameter DATA_WIDTH=32,ADDR_WIDTH=14,STRB_WIDTH=4,ID_WIDTH=6)(\n'+',\n'.join(f'{d} wire {w} {n}' for d,w,n in rports)+'\n);\n'
error+='''reg writing=0,reading=0,bvalid=0;
reg[8:0] wleft=0,rleft=0;reg[5:0] wid=0,rid=0;
assign s_axi_awready=!writing&&!bvalid&&!rst;
assign s_axi_wready=writing&&!rst;
assign s_axi_bid=wid;assign s_axi_bresp=2'b10;assign s_axi_bvalid=bvalid&&!rst;
assign s_axi_arready=!reading&&!rst;
assign s_axi_rid=rid;assign s_axi_rdata=32'hbad0add0;assign s_axi_rresp=2'b10;
assign s_axi_rlast=rleft==1;assign s_axi_rvalid=reading&&!rst;
always @(posedge clk)begin
 if(rst)begin writing<=0;reading<=0;bvalid<=0;wleft<=0;rleft<=0;wid<=0;rid<=0;end
 else begin
  if(s_axi_awvalid&&s_axi_awready)begin writing<=1;wid<=s_axi_awid;wleft<=s_axi_awlen+9'd1;end
  if(s_axi_wvalid&&s_axi_wready)begin
   wleft<=wleft-1'b1;if(wleft==1)begin writing<=0;bvalid<=1;end
  end
  if(s_axi_bvalid&&s_axi_bready)bvalid<=0;
  if(s_axi_arvalid&&s_axi_arready)begin reading<=1;rid<=s_axi_arid;rleft<=s_axi_arlen+9'd1;end
  if(s_axi_rvalid&&s_axi_rready)begin rleft<=rleft-1'b1;if(rleft==1)reading<=0;end
 end
end
endmodule
'''
(HERE/'axi_error_target.sv').write_text(error)
decl='\n'.join(('reg' if d=='input' else 'wire')+' '+w+' '+n+('=0;' if d=='input' else ';') for d,w,n in front)
template=(HERE/'tb_template.sv').read_text()
(HERE/'tb_axi_fabric.sv').write_text(template.replace('// PORT_DECLARATIONS',decl))
names=['axi_crossbar','axi_crossbar_wr','axi_crossbar_rd','axi_crossbar_addr','axi_register_wr','axi_register_rd','arbiter','priority_encoder','axi_ram']
sources=[f'vendor/verilog-axi/rtl/{n}.v' for n in names]+[f'projects/hard-bench/axi-fabric/{n}.sv' for n in ['rv_delay','axi_error_target','axi_write_completion_guard','axi_fabric_top']]
# Locally audited overlay: decode misses must participate in the same ID ordering
# and transaction accounting as mapped accesses. The vendor checkout stays intact.
original=(ROOT/'vendor/verilog-axi/rtl/axi_crossbar_addr.v').read_text()
patched=original
edits=[
 ('reg [CL_M_COUNT-1:0] thread_m_reg[S_INT_THREADS-1:0];','reg [CL_M_COUNT-1:0] thread_m_reg[S_INT_THREADS-1:0];\nreg thread_decerr_reg[S_INT_THREADS-1:0];'),
 ('thread_match[n] && thread_m_reg[n] == m_select_next && (M_REGIONS < 2 || thread_region_reg[n] == m_axi_aregion_next)',
  'thread_match[n] && thread_decerr_reg[n] == m_decerr_next && (m_decerr_next || (thread_m_reg[n] == m_select_next && (M_REGIONS < 2 || thread_region_reg[n] == m_axi_aregion_next)))'),
 ('thread_m_reg[n] <= m_select_next;','thread_m_reg[n] <= m_select_next;\n                thread_decerr_reg[n] <= m_decerr_next;'),
 ('// address decode successful\n                    if', '// address decode successful\n                    m_decerr_next = 1\'b0;\n                    if'),
 ('''                    // decode error
                    m_axi_avalid_next = 1'b0;
                    m_decerr_next = 1'b1;
                    m_wc_valid_next = WC_OUTPUT;
                    m_rc_valid_next = 1'b1;
                    state_next = STATE_DECODE;''',
 '''                    // Decode misses obey ID ordering and consume an accepted slot too.
                    m_decerr_next = 1'b1;
                    if (!trans_limit && (thread_match_dest || (!(&thread_active) && !thread_match))) begin
                        m_axi_avalid_next = 1'b0;
                        m_wc_valid_next = WC_OUTPUT;
                        m_rc_valid_next = 1'b1;
                        trans_start = 1'b1;
                        state_next = STATE_DECODE;
                    end else begin
                        state_next = STATE_IDLE;
                    end''')]
for old,new in edits:
    assert patched.count(old)==1,old
    patched=patched.replace(old,new)
(HERE/'axi_crossbar_addr_guarded.v').write_text(patched)
patch_text=''.join(difflib.unified_diff(original.splitlines(True),patched.splitlines(True),fromfile='vendor/verilog-axi/rtl/axi_crossbar_addr.v',tofile='projects/hard-bench/axi-fabric/axi_crossbar_addr_guarded.v'))
sources=[p if not p.endswith('/axi_crossbar_addr.v') else 'projects/hard-bench/axi-fabric/axi_crossbar_addr_guarded.v' for p in sources]
original_wr=(ROOT/'vendor/verilog-axi/rtl/axi_crossbar_wr.v').read_text()
patched_wr=original_wr
wr_edits=[
 ('        wire                  decerr_m_axi_bready;',
  "        wire                  decerr_m_axi_bready;\n        reg decerr_pending_reg = 1'b0, decerr_pending_next;"),
 ('assign m_rc_ready = !decerr_m_axi_bvalid_reg;',
  'assign m_rc_ready = !decerr_m_axi_bvalid_reg && !decerr_pending_reg;'),
 ('''            decerr_m_axi_bvalid_next = decerr_m_axi_bvalid_reg;

            if (decerr_m_axi_bvalid_reg) begin
                if (decerr_m_axi_bready) begin
                    decerr_m_axi_bvalid_next = 1'b0;
                end
            end else if (m_rc_valid && m_rc_ready) begin
                decerr_m_axi_bid_next = int_s_axi_awid[m*S_ID_WIDTH +: S_ID_WIDTH];
                decerr_m_axi_bvalid_next = 1'b1;
            end''',
 '''            decerr_m_axi_bvalid_next = decerr_m_axi_bvalid_reg;
            decerr_pending_next = decerr_pending_reg;

            if (decerr_m_axi_bvalid_reg && decerr_m_axi_bready)
                decerr_m_axi_bvalid_next = 1'b0;
            // RC can precede the corresponding write command and AW handshake.
            // Keep it pending outside B arbitration until all dropped W data arrive.
            if (m_rc_valid && m_rc_ready) begin
                decerr_m_axi_bid_next = int_s_axi_awid[m*S_ID_WIDTH +: S_ID_WIDTH];
                decerr_pending_next = 1'b1;
            end
            if (decerr_pending_next && w_drop_reg && w_select_valid_reg &&
                    int_s_axi_wvalid[m] && int_s_axi_wready[m] && int_s_axi_wlast[m]) begin
                decerr_m_axi_bvalid_next = 1'b1;
                decerr_pending_next = 1'b0;
            end'''),
 ('''                decerr_m_axi_bvalid_reg <= 1'b0;
            end else begin
                decerr_m_axi_bvalid_reg <= decerr_m_axi_bvalid_next;
            end''',
 '''                decerr_m_axi_bvalid_reg <= 1'b0;
                decerr_pending_reg <= 1'b0;
            end else begin
                decerr_m_axi_bvalid_reg <= decerr_m_axi_bvalid_next;
                decerr_pending_reg <= decerr_pending_next;
            end''')]
for old,new in wr_edits:
    assert patched_wr.count(old)==1,old
    patched_wr=patched_wr.replace(old,new)
(HERE/'axi_crossbar_wr_guarded.v').write_text(patched_wr)
patch_text+=''.join(difflib.unified_diff(original_wr.splitlines(True),patched_wr.splitlines(True),fromfile='vendor/verilog-axi/rtl/axi_crossbar_wr.v',tofile='projects/hard-bench/axi-fabric/axi_crossbar_wr_guarded.v'))
(HERE/'upstream-fix.patch').write_text(patch_text)
sources=[p if not p.endswith('/axi_crossbar_wr.v') else 'projects/hard-bench/axi-fabric/axi_crossbar_wr_guarded.v' for p in sources]
(HERE/'sources.json').write_text(json.dumps({'top':'axi_fabric_top','sources':sources},indent=2))
sim={'sources':sources+['projects/hard-bench/axi-fabric/tb_axi_fabric.sv'],'top':'tb_axi_fabric','capture_top_wave':False}
(HERE/'sim.json').write_text(json.dumps(sim,indent=2))
(HERE/'tb_axi_fabric_negative.sv').write_text('module tb_axi_fabric_negative;tb_axi_fabric #(.NEGATIVE_CONTROL(1)) test();endmodule\n')
negative={**sim,'sources':sim['sources']+['projects/hard-bench/axi-fabric/tb_axi_fabric_negative.sv'],'top':'tb_axi_fabric_negative'}
(HERE/'negative.json').write_text(json.dumps(negative,indent=2))
trace_tb=template.replace('// PORT_DECLARATIONS',decl).replace('module tb_axi_fabric #(', 'module tb_axi_fabric_trace #(').replace('NEGATIVE_CONTROL=0,TRACE_ONLY=0','NEGATIVE_CONTROL=0,TRACE_ONLY=1')
(HERE/'tb_axi_fabric_trace.sv').write_text(trace_tb)
(HERE/'trace.json').write_text(json.dumps({'sources':sources+['projects/hard-bench/axi-fabric/tb_axi_fabric_trace.sv'],'top':'tb_axi_fabric_trace','capture_top_wave':True},indent=2))
(HERE/'impl.json').write_text(json.dumps({'script':'projects/hard-bench/axi-fabric/implement.tcl'},indent=2))
(HERE/'implement.tcl').write_text('set root $::env(EDA_WORKSPACE)\nset_param general.maxThreads 2\nset_param synth.maxThreads 1\n'+''.join('read_verilog -sv [file join $root '+p.replace('/', ' ')+']\n' for p in sources)+'set top axi_fabric_top\nsource [file join $root projects system-bench implement-common.tcl]\n')
(HERE/'manifest.json').write_text(json.dumps({'upstream_commit':'516bd5dadc3365b7f9e225d2af8fe0b8d804fe53','sources':sources,'rtl_lines':sum(len((ROOT/p).read_text().splitlines()) for p in sources),'sha256':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in sources},'seeds':['0xc001cafe','0x5eed1234','0xdeadbeef','0x13579bdf'],'addresses':{'RAM0':'0x0000-0x3fff','RAM1':'0x4000-0x7fff','SLVERR_target':'0x8000-0xbfff','DECERR_unmapped':'0xc000-0xffff'},'expected_total_bursts':4656},indent=2))
