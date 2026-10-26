# z_dma fixed design contract

Implement `z_dma.sv` from the supplied port-only shell. Target: `xc7a100tfgg676-2` (Artix-7 100T), one 100 MHz clock. RTL must be synthesizable Verilog/SystemVerilog; the independent testbench is verification code only.

## Interface

All signals are synchronous to the rising edge of `clk`. `rst` is active-high **synchronous** reset. A transfer occurs only when VALID and READY are both high at a rising edge. The sender must hold VALID and its payload unchanged while stalled. No combinational dependence of an output VALID on its corresponding input READY is permitted.

| Signal | Direction | Width | Meaning |
|---|---|---:|---|
| clk, rst | input | 1 each | 100 MHz clock; synchronous reset |
| desc_valid | input | 1 | Descriptor available |
| desc_ready | output | 1 | Descriptor can be accepted |
| desc_src, desc_dst | input | 32 each | Byte addresses |
| desc_len | input | 16 | Exact byte count, 1 through 4096 |
| desc_tag | input | 8 | Opaque completion tag |
| status_valid | output | 1 | Completion available |
| status_ready | input | 1 | Completion accepted |
| status_tag | output | 8 | Accepted descriptor's tag |
| status_error | output | 1 | Any RRESP/BRESP error for this descriptor |
| m_axi_araddr | output | 32 | Read burst byte address |
| m_axi_arlen | output | 8 | Read beats minus one |
| m_axi_arsize | output | 3 | Always 3 (8 bytes) |
| m_axi_arburst | output | 2 | Always 1 (INCR) |
| m_axi_arvalid | output | 1 | Read address valid |
| m_axi_arready | input | 1 | Read address ready |
| m_axi_rdata | input | 64 | Read data |
| m_axi_rresp | input | 2 | 0=OKAY; every nonzero response is an error |
| m_axi_rlast | input | 1 | Last read beat |
| m_axi_rvalid | input | 1 | Read data valid |
| m_axi_rready | output | 1 | Read data ready |
| m_axi_awaddr | output | 32 | Write burst byte address |
| m_axi_awlen | output | 8 | Write beats minus one |
| m_axi_awsize | output | 3 | Always 3 (8 bytes) |
| m_axi_awburst | output | 2 | Always 1 (INCR) |
| m_axi_awvalid | output | 1 | Write address valid |
| m_axi_awready | input | 1 | Write address ready |
| m_axi_wdata | output | 64 | Write data; lane 0 is lowest byte address |
| m_axi_wstrb | output | 8 | Exact valid-byte mask |
| m_axi_wlast | output | 1 | Last write beat |
| m_axi_wvalid | output | 1 | Write data valid |
| m_axi_wready | input | 1 | Write data ready |
| m_axi_bresp | input | 2 | Write response; every nonzero value is an error |
| m_axi_bvalid | input | 1 | Write response valid |
| m_axi_bready | output | 1 | Write response ready |

AXI IDs are fixed to zero and omitted. LOCK/CACHE/PROT/QOS/REGION/USER are omitted; an integration wrapper may tie the corresponding optional request attributes to zero. No AXI-Lite/control-register interface is required.

## Descriptor and ordering rules

Inputs are legal: both addresses are 8-byte aligned, length is 1..4096, address arithmetic does not wrap, and source and destination ranges do not overlap. Invalid descriptors and overlapping-copy semantics are outside this contract. Memory is not changed by another agent during a copy. The source allocation includes the complete final 8-byte read beat; bytes beyond `desc_len` may be read but must never be written.

Provide capacity for **at least four pending descriptors plus one active descriptor**. Accept and complete descriptors in order. Completion backpressure must preserve tag/error. Start the next descriptor's AXI traffic only after the preceding status handshake. Queue acceptance may continue during active work and status stalls, subject to available storage.

There is at most one outstanding AXI transaction, across reads and writes. For each chunk: issue one AR, consume the entire R burst into local storage, then issue its matching AW and W, consume B, then proceed. W handshakes must follow the AW handshake. Do not issue another AR until the previous B handshake. No AW is allowed for a chunk containing a failed R beat.

Each burst has 1..16 beats, SIZE=3 and BURST=INCR. Its full 8-byte beats must remain inside one 4 KiB region for **both** the current source and destination addresses. Arbitrary legal chunk sizes are accepted; maximal bursts are not required. AR and AW for a chunk have equal beat counts. Except for the final descriptor beat, WSTRB is `8'hff`; the final beat uses exactly the low `remaining_bytes` bits. No byte outside `[dst, dst+len)` may be modified. WLAST and RLAST correspond to the declared final beat.

On any non-OKAY RRESP, consume/drain the rest of that read burst, write none of that burst, stop this descriptor, and return its tag with error=1. Previously completed chunks remain written. On non-OKAY BRESP, stop subsequent chunks and return error=1; the failed write burst may already have modified memory. Other queued descriptors must subsequently continue. A successful descriptor returns error=0 exactly once after all bytes and the final B response have completed.

Reset discards active work, pending descriptors and pending statuses. The environment simultaneously cancels its AXI transactions; no responses from before reset are replayed. Previously accepted write bytes remain in memory. After reset the DMA accepts fresh descriptors. No status is returned for a descriptor discarded by reset. Within the first full clock after reset, ARVALID/AWVALID/WVALID/status_valid must be low.

## Fixed acceptance

`tb_z_dma.sv` is an independent byte-memory AXI slave and scoreboard. It uses static arrays, a fixed xorshift seed, negative-edge stimulus and rising-edge sampling. It runs two reset-abort epochs (read outstanding; write bytes accepted but response outstanding), each requiring five descriptor acceptances, followed by 128 completed descriptors. Main coverage includes 88 successes, 24 R errors (first/middle/last position policies; first/second burst), 16 B errors (first/second burst), lengths 1..4096 including nonmultiples of eight, differing source/destination 4 KiB offsets, FIFO pressure and independent channel/status stalls. A position policy selects beat 0, floor(beats/2), or beats-1; these positions can coincide for short legal bursts, so distinct interior-beat error coverage is implementation-dependent. Error responses alternate SLVERR and DECERR. Descriptor stalls are measured but are not a pass requirement: larger legal FIFOs may accept the whole batch without stalling.

The checker validates every accepted address/beat/status, exact burst correspondence, 4 KiB boundaries, data/WSTRB/WLAST, stable stalled requests/status, ordering, and full memory against the reference after reset and at completion. It has a cycle watchdog and an independent simulation-time watchdog. The runner must also impose an external process wall-time limit. Success prints exactly one line beginning `FROM_ZERO_PASS project=dma descriptors=128 bytes=... protocol_checks=...`; every failure uses `$fatal`.

The empty shell must fail this checker. Simulation does not prove all AXI interleavings, analog behavior, hardware operation, setup/hold closure, or reset with an AXI slave that retains old transactions. Timing uses `clocks.xdc`: 10 ns period and 2 ns input/output delay, including synchronous reset. Synthesis, implementation, timing and DRC evidence are separate acceptance domains.
