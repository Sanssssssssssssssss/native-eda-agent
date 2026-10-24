// Small DUTs and an independent JavaScript reference produce frozen SV assertions.
export const GENERATOR_VERSION = '1';
export const GENERATOR_FAMILIES = ['adder', 'mux', 'popcount', 'priority', 'counter', 'shift', 'pattern', 'handshake', 'regfile', 'fifo', 'multiply', 'fir'];

function random(seed) {
  let state = seed >>> 0;
  return () => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state; };
}

export function reference(family, vectors, width) {
  const mask = 2 ** width - 1;
  let count = 0, history = [], bits = '', memory = [0, 0, 0, 0], queue = [];
  return vectors.map(({ a, b, ctrl, reset }) => {
    switch (family) {
      case 'adder': return Number(BigInt(a) + BigInt(b));
      case 'mux': return [a, b][ctrl & 1];
      case 'popcount': return a.toString(2).split('').filter(bit => bit === '1').length;
      case 'priority': { const index = Array.from({ length: width }, (_, i) => (a >>> i) & 1).findIndex(Boolean); return index < 0 ? 0 : 256 + index; }
      case 'multiply': return Array.from({ length: b }, () => a).reduce((sum, n) => sum + n, 0);
      case 'counter': count = reset ? 0 : (count + (ctrl & 1)) % (mask + 1); return count;
      case 'shift':
        if (reset) history = [];
        else if (ctrl & 1) history = [a & 1, ...history].slice(0, width);
        return history.reduce((sum, bit, i) => sum + bit * 2 ** i, 0);
      case 'pattern': bits = reset ? '' : (bits + (a & 1)).slice(-3); return bits === '101' ? 1 : 0;
      case 'handshake': count = reset ? 0 : (count + ((ctrl & 3) === 3 ? 1 : 0)) % (mask + 1); return count;
      case 'regfile': if (reset) memory = [0, 0, 0, 0]; else if (ctrl & 1) memory[a & 3] = b; return memory[a & 3];
      case 'fifo': {
        if (reset) queue = [];
        else {
          const push = Boolean(ctrl & 1) && queue.length < 4;
          const pop = Boolean(ctrl & 2) && queue.length > 0;
          if (pop) queue.shift();
          if (push) queue.push(a);
        }
        return queue.length * 2 ** width + (queue[0] || 0);
      }
      case 'fir':
        history = reset ? [] : [a, ...history].slice(0, 3);
        return history.reduce((sum, sample, i) => sum + sample * [1, 2, 1][i], 0);
      default: throw new Error(`Unknown generator family: ${family}`);
    }
  });
}

export function generateRtl({ family, width = 8, seed = 1, samples = 40 }) {
  if (!GENERATOR_FAMILIES.includes(family) || ![4, 8].includes(width) || !Number.isSafeInteger(seed) || seed < 0 || seed > 0xffffffff || !Number.isSafeInteger(samples) || samples < 16 || samples > 256) throw new Error('Invalid generated RTL configuration');
  const next = random(seed), mask = 2 ** width - 1;
  const vectors = Array.from({ length: samples }, (_, i) => ({
    a: i < 8 ? [0, mask, 1, mask - 1, 2, 0, mask, 1][i] : (next() >>> 8) & mask,
    b: i < 8 ? [0, 1, mask, mask, 3, mask, 0, 1][i] : (next() >>> 8) & mask,
    ctrl: i < 16 ? i : (next() >>> 8) & 15,
    reset: i === 0 || i % 19 === 0 ? 1 : 0,
  }));
  const expected = reference(family, vectors, width);
  const snippets = {
    adder: 'always @* q = {1\'b0,a} + {1\'b0,b};',
    mux: 'always @* q = ctrl[0] ? b : a;',
    popcount: 'integer i; always @* begin q=0; for(i=0;i<W;i=i+1) q=q+a[i]; end',
    priority: 'integer i; always @* begin q=0; for(i=W-1;i>=0;i=i-1) if(a[i]) q=256+i; end',
    multiply: 'always @* q = a * b;',
    counter: "reg [W-1:0] value; always @(posedge clk) if(rst) value<=0; else if(ctrl[0]) value<=value+1'b1; always @* q=value;",
    shift: "reg [W-1:0] value; always @(posedge clk) if(rst) value<=0; else if(ctrl[0]) value<={value[W-2:0],a[0]}; always @* q=value;",
    pattern: "reg [1:0] state; always @(posedge clk) if(rst) begin state<=0;q<=0;end else begin q<=(state==2 && a[0]); case(state) 0:state<=a[0]?1:0; 1:state<=a[0]?1:2; 2:state<=a[0]?1:0; default:state<=0; endcase end",
    handshake: "reg [W-1:0] transfers; always @(posedge clk) if(rst) transfers<=0; else if(ctrl[0] && ctrl[1]) transfers<=transfers+1'b1; always @* q=transfers;",
    regfile: 'reg [W-1:0] mem[0:3]; integer i; always @(posedge clk) if(rst) begin for(i=0;i<4;i=i+1) mem[i]<=0;end else if(ctrl[0]) mem[a[1:0]]<=b; always @* q=mem[a[1:0]];',
    fifo: "reg [W-1:0] mem[0:3]; reg[1:0] wr,rd; reg[2:0] count; wire push=ctrl[0] && count<4; wire pop=ctrl[1] && count>0; always @(posedge clk) if(rst) begin wr<=0;rd<=0;count<=0;end else begin if(push) begin mem[wr]<=a;wr<=wr+1'b1;end if(pop) rd<=rd+1'b1;case({push,pop}) 2'b10:count<=count+1'b1;2'b01:count<=count-1'b1;default:count<=count;endcase end always @* q=(count << W) | (count==0 ? 0 : mem[rd]);",
    fir: 'reg [W-1:0] z0,z1; always @(posedge clk) if(rst) begin z0<=0;z1<=0;q<=0;end else begin q<=a+2*z0+z1;z0<=a;z1<=z0;end',
  };
  const rtl = `\`timescale 1ns/1ps\nmodule bench_dut #(parameter W=${width})(input clk,rst,input[W-1:0]a,b,input[3:0]ctrl,output reg[31:0]q);\n${snippets[family]}\nendmodule\n`;
  const testbench = `\`timescale 1ns/1ps
module tb_benchmark;
reg clk=0,rst=1; reg[${width - 1}:0] a=0,b=0; reg[3:0]ctrl=0; wire[31:0]q; integer checks=0;
always #5 clk=~clk;
bench_dut dut(.clk(clk),.rst(rst),.a(a),.b(b),.ctrl(ctrl),.q(q));
task check; input[${width - 1}:0]va,vb;input[3:0]vc;input vr;input[31:0]expected;
begin @(negedge clk);a=va;b=vb;ctrl=vc;rst=vr;@(posedge clk);#1;checks=checks+1;
if(q !== expected) $fatal(1,"BENCH_FAIL index=%0d actual=%0d expected=%0d",checks,q,expected);end endtask
initial begin
${vectors.map((v, i) => `check(${width}'d${v.a},${width}'d${v.b},4'd${v.ctrl},1'b${v.reset},32'd${expected[i]});`).join('\n')}
$display("BENCH_PASS checks=%0d",checks);$finish;end
initial begin #1000000;$fatal(1,"BENCH_TIMEOUT");end
endmodule
`;
  return { rtl, testbench, oracle: { generator_version: GENERATOR_VERSION, family, width, seed, samples, vectors: vectors.map((v, i) => ({ ...v, expected: expected[i] })) } };
}
