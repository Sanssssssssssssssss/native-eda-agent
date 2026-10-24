`timescale 1ns/1ps
`default_nettype none
// Descriptors are eight little-endian words: src,dst,len,keyptr,ivptr,
// flags(bit0=256-bit key),next,cookie. RAM addresses and pointers are word aligned.
module crypto_ctr_dma(
    input wire clk,resetn,start,irq_ack,input wire [31:0] descriptor_pointer,
    output wire m_valid,output reg [31:0] m_addr,m_wdata,output reg [3:0] m_wstrb,
    input wire m_ready,input wire [31:0] m_rdata,
    output reg busy,irq,output reg [7:0] error_code,
    output reg [31:0] completed,rejected,bytes_written,last_cookie
);
    localparam IDLE=0,DESC=1,CHECK=2,KEY=3,IV=4,INIT=5,INIT_LOW=6,INIT_HIGH=7,
        NEXT=8,NEXT_LOW=9,NEXT_HIGH=10,READ=11,WRITE=12,ADVANCE=13,FAULT=14;
    reg [3:0] state;
    reg [31:0] desc[0:7];
    reg [31:0] pointer,position;
    reg [3:0] index;
    reg [2:0] words;
    reg [255:0] key_reg;
    reg [127:0] counter,stream;
    reg [31:0] output_words[0:3];
    wire [127:0] aes_result;
    wire aes_ready,aes_valid;
    wire [32:0] src_end={1'b0,desc[0]}+{1'b0,desc[2]};
    wire [32:0] dst_end={1'b0,desc[1]}+{1'b0,desc[2]};
    wire [32:0] key_end={1'b0,desc[3]}+(desc[5][0]?33'd32:33'd16);
    wire [32:0] iv_end={1'b0,desc[4]}+33'd16;
    wire [31:0] remaining=desc[2]-position;
    wire [31:0] write_remaining=remaining-{26'b0,index,2'b0};
    function [31:0] swap32(input [31:0] v);
        swap32={v[7:0],v[15:8],v[23:16],v[31:24]};
    endfunction
    assign m_valid=busy&&(state==DESC||state==KEY||state==IV||state==READ||state==WRITE);
    always @* begin
        m_addr=0;m_wdata=0;m_wstrb=0;
        case(state)
            DESC:m_addr=pointer+{26'b0,index,2'b0};
            KEY:m_addr=desc[3]+{26'b0,index,2'b0};
            IV:m_addr=desc[4]+{26'b0,index,2'b0};
            READ:m_addr=desc[0]+position+{26'b0,index,2'b0};
            WRITE:begin
                m_addr=desc[1]+position+{26'b0,index,2'b0};
                m_wdata=output_words[index[1:0]];
                m_wstrb=write_remaining>=4?4'hf:(4'hf>>(4-write_remaining));
            end
            default:;
        endcase
    end
    aes_core aes(.clk(clk),.reset_n(resetn),.encdec(1'b1),.init(state==INIT),
        .next(state==NEXT),.ready(aes_ready),.key(key_reg),.keylen(desc[5][0]),
        .block(counter),.result(aes_result),.result_valid(aes_valid));
    integer j;
    always @(posedge clk) begin
        if(!resetn)begin
            state<=IDLE;busy<=0;irq<=0;error_code<=0;completed<=0;rejected<=0;
            bytes_written<=0;last_cookie<=0;pointer<=0;position<=0;index<=0;words<=0;
            key_reg<=0;counter<=0;stream<=0;
            for(j=0;j<8;j=j+1)desc[j]<=0;
        end else begin
            if(irq_ack)irq<=0;
            if(start&&busy)rejected<=rejected+1;
            case(state)
                IDLE:if(start)begin
                    busy<=1;irq<=0;error_code<=0;completed<=0;pointer<=descriptor_pointer;index<=0;
                    if(descriptor_pointer[1:0]!=0 || descriptor_pointer>65504)begin error_code<=1;state<=FAULT;end
                    else state<=DESC;
                end
                DESC:if(m_ready)begin
                    desc[index]<=m_rdata;
                    if(index==7)begin index<=0;state<=CHECK;end else index<=index+1;
                end
                CHECK:begin
                    position<=0;index<=0;key_reg<=0;counter<=0;
                    if(desc[2]==0||desc[2]>4096)begin error_code<=2;state<=FAULT;end
                    else if(desc[0][1:0]!=0||desc[1][1:0]!=0||desc[3][1:0]!=0||desc[4][1:0]!=0||
                            src_end>65536||dst_end>65536||key_end>65536||iv_end>65536)begin error_code<=3;state<=FAULT;end
                    else if(desc[6]!=0&&(desc[6][1:0]!=0||desc[6]>65504))begin error_code<=4;state<=FAULT;end
                    else if(desc[0]!=desc[1]&&desc[0]<dst_end&&desc[1]<src_end)begin error_code<=5;state<=FAULT;end
                    else if(desc[5]>1||completed>=16)begin error_code<=6;state<=FAULT;end
                    else state<=KEY;
                end
                KEY:if(m_ready)begin
                    key_reg[255-index*32-:32]<=swap32(m_rdata);
                    if(index==(desc[5][0]?7:3))begin index<=0;state<=IV;end else index<=index+1;
                end
                IV:if(m_ready)begin
                    counter[127-index*32-:32]<=swap32(m_rdata);
                    if(index==3)begin index<=0;state<=INIT;end else index<=index+1;
                end
                INIT:state<=INIT_LOW;
                INIT_LOW:if(!aes_ready)state<=INIT_HIGH;
                INIT_HIGH:if(aes_ready)state<=NEXT;
                NEXT:state<=NEXT_LOW;
                NEXT_LOW:if(!aes_ready)state<=NEXT_HIGH;
                NEXT_HIGH:if(aes_ready&&aes_valid)begin
                    stream<=aes_result;index<=0;words<=remaining>=16?4:((remaining+3)>>2);state<=READ;
                end
                READ:if(m_ready)begin
                    output_words[index[1:0]]<=m_rdata^swap32(stream[127-index*32-:32]);
                    if(index+1==words)begin index<=0;state<=WRITE;end else index<=index+1;
                end
                WRITE:if(m_ready)begin
                    bytes_written<=bytes_written+(write_remaining>=4?4:write_remaining);
                    if(index+1==words)begin
                        index<=0;
                        if(remaining<=16)state<=ADVANCE;
                        else begin position<=position+16;counter<=counter+1'b1;state<=NEXT;end
                    end else index<=index+1;
                end
                ADVANCE:begin
                    completed<=completed+1;last_cookie<=desc[7];
                    if(desc[6]!=0)begin pointer<=desc[6];index<=0;state<=DESC;end
                    else begin busy<=0;irq<=1;state<=IDLE;end
                end
                FAULT:begin busy<=0;irq<=1;state<=IDLE;end
                default:begin error_code<=255;state<=FAULT;end
            endcase
        end
    end
endmodule
`default_nettype wire
