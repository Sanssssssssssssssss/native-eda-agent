# CDC review of the routed design

Reviewed `artifacts/hard-ethernet-cdc-impl-20261022T184242Z-8aa581`. Vivado reports **0 Critical entries, 10 Info entries and 34 Warning entries**. Warnings are retained and classified below; this is a structural/source review with simulation and routed constraints, not formal CDC signoff or a metastability MTBF proof.

| Rule | Count | Actual crossing and review |
|---|---:|---|
| CDC-3 | 10 Info | Single-bit FIFO reset/status/update/ack and MAC TX status synchronizers. The report identifies two destination stages with `ASYNC_REG` and targeted maximum-delay constraints. |
| CDC-6 | 3 Warning | Two 14-bit FIFO read-pointer crossings use registered Gray code and two-stage synchronization. The third is the MAC RX pair of **independent** bad-frame/bad-FCS toggle events; it is not an atomic multi-bit word. |
| CDC-15 | 28 Warning | Two 14-bit committed-write-pointer buses are held by the source while a synchronized update toggle and acknowledgement transfer ownership. The target captures the stable bus only on the synchronized update event. These are intentional handshake-controlled buses, not free-running binary counters sampled asynchronously. |
| CDC-26 | 3 Warning | Endpoints are `reset` to the first `sync_reset/sync_reg_reg[0]/PRE` in each clock domain. The report labels these “LUTRAM read/write potential collision”, which does not describe the listed reset endpoints. RTL implements asynchronous assertion with a three-stage local-clock release chain; the reset exceptions target its asynchronous preset/reset pins. The label discrepancy remains recorded rather than silently waived. |

Source basis: `axis_async_fifo.v` updates `wr_ptr_sync_commit_reg` only when the previous update has been acknowledged (lines 388–394, 450–480), then samples at the destination on the synchronized update transition (lines 586–591). Read pointers are registered as `bin ^ (bin >> 1)` (line 672) and pass through two synchronization registers (lines 570–571). `eth_mac_1g_fifo.v` XORs the two RX status events into independent source toggle bits and synchronizes/detects each bit separately. `sync_reset.v` asynchronously presets a three-bit chain and shifts out zero on local clock edges.

Independent routed-DCP inspection confirms all nine reset-chain cells (three per domain) are `FDPE` with `ASYNC_REG=1`; see `artifacts/hard-bench-assessment-20261023/reset-cell-properties.txt`. This supports the reset architecture exception and confirms that the CDC-26 LUTRAM label does not match the listed cell types. Machine-readable review: `cdc-review.json`.

All four constrained buses meet skew requirements:

| Bus | Requirement | Actual skew | Slack |
|---|---:|---:|---:|
| RX FIFO read Gray pointer | 8 ns | 0.830 ns | +7.170 ns |
| RX FIFO committed write pointer | 10 ns | 1.117 ns | +8.883 ns |
| TX FIFO read Gray pointer | 10 ns | 0.863 ns | +9.137 ns |
| TX FIFO committed write pointer | 8 ns | 1.013 ns | +6.987 ns |

`ignored-exceptions.rpt` reports **no ignored timing exceptions**. There is no global asynchronous `set_clock_groups` constraint to override the Gray-pointer/commit-bus maximum-delay checks. `check-timing.rpt` reports zero missing clocks and zero unconstrained internal endpoints. Its only missing input delay is the intentionally asynchronous external `reset`; no fictitious synchronous input delay was assigned to suppress this warning.

The source hold/update/ack protocol, bus constraints and two asynchronous clock-ratio simulations support this bounded integration result. They do not prove every clock ratio, arbitrary reset sequencing, pulse-rate limit, metastability behavior or complete FIFO formal correctness. OOC clock-source placement is unspecified; the 100/125/125 MHz timing result is not board clock-distribution signoff.
