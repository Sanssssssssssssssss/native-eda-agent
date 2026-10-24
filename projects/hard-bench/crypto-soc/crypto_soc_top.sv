`timescale 1ns/1ps
`default_nettype none
module crypto_soc_top(
    input wire clk,resetn,input wire [31:0] seed,input wire [2:0] stall_mask,
    output wire trap,output reg result_valid,output reg [31:0] result_data,result_tag,
    output reg done,output reg [31:0] finish_code,firmware_work,
    output wire dma_busy,output wire [31:0] cpu_grants,dma_grants,both_pending,owner_switches,cpu_during_dma,
    output reg [31:0] irq_handled
);
    wire c_valid,c_ready,c_instr;wire [31:0] c_addr,c_wdata,c_rdata;wire [3:0] c_wstrb;
    wire c_ram_ready;wire [31:0] c_ram_data;
    reg io_ready;reg [31:0] io_data,desc_pointer,tag_reg;
    reg start_pulse,ack_pulse;
    wire d_valid,d_ready;wire [31:0] d_addr,d_wdata,d_rdata;wire [3:0] d_wstrb;
    wire irq;wire [7:0] error_code;wire [31:0] completed,rejected,bytes_written,last_cookie;
    wire io_select=c_addr[31:16]!=0;
    assign c_ready=io_select?io_ready:c_ram_ready;
    assign c_rdata=io_select?io_data:c_ram_data;
    picorv32 #(.ENABLE_MUL(1),.ENABLE_DIV(1),.BARREL_SHIFTER(1),.ENABLE_IRQ(1),
        .ENABLE_IRQ_TIMER(0),.LATCHED_IRQ(32'hffff_ffef),.STACKADDR(32'h10000)) cpu(
        .clk(clk),.resetn(resetn),.trap(trap),.mem_valid(c_valid),.mem_instr(c_instr),
        .mem_ready(c_ready),.mem_addr(c_addr),.mem_wdata(c_wdata),.mem_wstrb(c_wstrb),.mem_rdata(c_rdata),
        .pcpi_wr(1'b0),.pcpi_rd(32'b0),.pcpi_wait(1'b0),.pcpi_ready(1'b0),.irq({27'b0,irq,4'b0}));
    crypto_shared_ram memory(.clk(clk),.resetn(resetn),.seed(seed),.stall_mask(stall_mask),
        .c_valid(c_valid&&!io_select),.c_addr(c_addr),.c_wdata(c_wdata),.c_wstrb(c_wstrb),
        .c_ready(c_ram_ready),.c_rdata(c_ram_data),.d_valid(d_valid),.d_addr(d_addr),.d_wdata(d_wdata),
        .d_wstrb(d_wstrb),.d_ready(d_ready),.d_rdata(d_rdata),.dma_busy(dma_busy),
        .cpu_grants(cpu_grants),.dma_grants(dma_grants),.both_pending(both_pending),
        .owner_switches(owner_switches),.cpu_during_dma(cpu_during_dma));
    crypto_ctr_dma dma(.clk(clk),.resetn(resetn),.start(start_pulse),.irq_ack(ack_pulse),
        .descriptor_pointer(desc_pointer),.m_valid(d_valid),.m_addr(d_addr),.m_wdata(d_wdata),
        .m_wstrb(d_wstrb),.m_ready(d_ready),.m_rdata(d_rdata),.busy(dma_busy),.irq(irq),
        .error_code(error_code),.completed(completed),.rejected(rejected),.bytes_written(bytes_written),.last_cookie(last_cookie));
    always @(posedge clk) begin
        if(!resetn)begin
            io_ready<=0;io_data<=0;desc_pointer<=0;start_pulse<=0;ack_pulse<=0;tag_reg<=0;
            result_valid<=0;result_data<=0;result_tag<=0;done<=0;finish_code<=0;firmware_work<=0;irq_handled<=0;
        end else begin
            io_ready<=0;start_pulse<=0;ack_pulse<=0;result_valid<=0;
            if(c_valid&&io_select&&!io_ready)begin
                io_ready<=1;io_data<=0;
                case(c_addr)
                    32'h10000000:io_data<=seed;
                    32'h10000004:begin io_data<=desc_pointer;if(|c_wstrb)desc_pointer<=c_wdata;end
                    32'h10000008:if(|c_wstrb)start_pulse<=c_wdata[0];
                    32'h1000000c:io_data<={16'b0,error_code,6'b0,irq,dma_busy};
                    32'h10000010:io_data<=completed;
                    32'h10000014:if(|c_wstrb)begin ack_pulse<=1;irq_handled<=irq_handled+1;end
                    32'h10000018:io_data<=rejected;
                    32'h1000001c:io_data<=bytes_written;
                    32'h10000020:if(|c_wstrb)begin result_valid<=1;result_data<=c_wdata;result_tag<=tag_reg;end
                    32'h10000024:if(|c_wstrb)tag_reg<=c_wdata;
                    32'h10000028:if(|c_wstrb)begin done<=1;finish_code<=c_wdata;end
                    32'h1000002c:if(|c_wstrb)firmware_work<=c_wdata;
                    32'h10000030:io_data<=irq_handled;
                    32'h10000034:io_data<=cpu_during_dma;
                    32'h10000038:io_data<=both_pending;
                    32'h1000003c:io_data<=owner_switches;
                    32'h10000040:io_data<=last_cookie;
                    default:io_data<=32'hbadadd00;
                endcase
            end
        end
    end
endmodule
`default_nettype wire
