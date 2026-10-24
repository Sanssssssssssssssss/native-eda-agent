`timescale 1ns/1ps
// A complete ready/valid buffer: delaying launch never withdraws a presented VALID.
module rv_delay #(parameter WIDTH=8)(
 input wire clk,rst,permit,input wire[WIDTH-1:0] s_data,input wire s_valid,
 output wire s_ready,output wire[WIDTH-1:0] m_data,output wire m_valid,input wire m_ready);
 reg full=0,launched=0;reg[WIDTH-1:0] data_reg;
 assign s_ready=!full&&!rst;assign m_valid=full&&launched&&!rst;assign m_data=data_reg;
 always @(posedge clk)begin
  if(rst)begin full<=0;launched<=0;end
  else begin
   if(s_valid&&s_ready)begin data_reg<=s_data;full<=1;end
   if(full&&!launched&&permit)launched<=1;
   if(m_valid&&m_ready)begin full<=0;launched<=0;end
  end
 end
endmodule
