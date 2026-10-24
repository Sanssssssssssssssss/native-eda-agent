`timescale 1ns/1ps
`default_nettype none
module crypto_shared_ram #(
    parameter FIRMWARE="E:/GPTProject2/EDAAgent/projects/hard-bench/crypto-soc/firmware.hex"
)(
    input wire clk,resetn,input wire [31:0] seed,input wire [2:0] stall_mask,
    input wire c_valid,input wire [31:0] c_addr,c_wdata,input wire [3:0] c_wstrb,
    output wire c_ready,output wire [31:0] c_rdata,
    input wire d_valid,input wire [31:0] d_addr,d_wdata,input wire [3:0] d_wstrb,
    output wire d_ready,output wire [31:0] d_rdata,input wire dma_busy,
    output reg [31:0] cpu_grants,dma_grants,both_pending,owner_switches,cpu_during_dma
);
    (* ram_style="block" *) reg [31:0] ram [0:16383];
    reg [31:0] data_reg;
    reg response,owner,last_owner,ever_granted;
    reg [31:0] rng;
    wire choose_dma=d_valid && (!c_valid || !last_owner);
    wire accept=resetn&&!response&&(c_valid||d_valid)&&((rng[2:0]&stall_mask)==0);
    wire [31:0] addr=choose_dma?d_addr:c_addr;
    wire [31:0] wdata=choose_dma?d_wdata:c_wdata;
    wire [3:0] wstrb=choose_dma?d_wstrb:c_wstrb;
    integer lane;
    initial $readmemh(FIRMWARE,ram);
    assign c_ready=response&&!owner;
    assign d_ready=response&&owner;
    assign c_rdata=data_reg;
    assign d_rdata=data_reg;
    always @(posedge clk) begin
        if(accept)begin
            data_reg<=ram[addr[15:2]];
            for(lane=0;lane<4;lane=lane+1)
                if(wstrb[lane])ram[addr[15:2]][8*lane+:8]<=wdata[8*lane+:8];
        end
        if(!resetn)begin
            response<=0;owner<=0;last_owner<=0;ever_granted<=0;
            rng<=seed^32'h6d2b79f5;
            cpu_grants<=0;dma_grants<=0;both_pending<=0;owner_switches<=0;cpu_during_dma<=0;
        end else begin
            rng<={rng[30:0],rng[31]^rng[21]^rng[1]^rng[0]};
            response<=0;
            if(c_valid&&d_valid)both_pending<=both_pending+1;
            if(accept)begin
                response<=1;owner<=choose_dma;last_owner<=choose_dma;ever_granted<=1;
                if(ever_granted && last_owner!=choose_dma)owner_switches<=owner_switches+1;
                if(choose_dma)dma_grants<=dma_grants+1;
                else begin cpu_grants<=cpu_grants+1;if(dma_busy)cpu_during_dma<=cpu_during_dma+1;end
            end
        end
    end
endmodule
`default_nettype wire
