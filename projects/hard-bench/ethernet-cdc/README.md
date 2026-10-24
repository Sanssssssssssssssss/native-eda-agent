# Three-clock GMII UDP echo system

Both clock configurations pass: **562 valid echoes, 566 complete output frames, 402,046 checked GMII bytes, 48 rejected malformed inputs and two mid-ingress reset recoveries**. MAC RX backpressure is observed for **2,071 / 3,841 cycles** in A/B; the expected-FCS corruption is rejected. Routed OOC timing at 100/125/125 MHz passes with **+2.510 ns setup / +0.073 ns hold**, 1,896 Slice LUTs, 2,964 FFs and eight BRAM tiles. CDC has **0 Critical and 34 Warning entries**, classified in `CDC-REVIEW.md`; all four bus-skew checks pass and no timing exceptions are ignored.

The design connects `eth_mac_1g_fifo` (two real asynchronous frame FIFOs), Ethernet frame decoding/encoding, an IPv4 length guard with commit-or-drop buffering, UDP/IPv4/ARP, and a paused UDP echo application. Stimulus enters at **GMII RX** and the checker observes **GMII TX**. It compares the entire expected output, including preamble/SFD, both MAC addresses, EtherType, IP/UDP headers, payload, Ethernet padding and all four FCS bytes.

The pinned MIT upstream is `alexforencich/verilog-ethernet` at `77320a9471d19c7dd383914bc049e02d9f4f1ffb`. Upstream files are unchanged. The integration compiles 30 RTL files / 12,513 lines. This is integration and verification of public cores, not a blind RTL generation score.

Each final clock configuration tests:

- 256 baseline UDP echo frames covering **251 distinct payload lengths**, 1–1,472 bytes.
- Six fault classes with four payload/length variants each: bad Ethernet FCS, truncated GMII frame, asserted GMII RX_ER, IPv4 length below its header, IPv4 length beyond received data, and bad IPv4 checksum.
- Every malformed input is followed by a valid recovery frame: 24 more echoes.
- Asynchronous reset **during an incomplete long GMII RX frame**, followed by fresh cold ARP resolution and one valid echo. Partial input must not leak after reset.
- Application pause while eight frames enter the system. Passing requires a measured MAC RX `tvalid && !tready` count greater than zero, followed by correct delivery of all queued frames. AXIS stall stability is also checked.

Thus each configuration checks **281 valid echoes**, **283 complete output frames** (including two full ARP requests), **201,023 GMII output bytes**, and 24 rejected malformed inputs. Two configurations replay the same vector set under different clock ratios; they are not independent projects or 562 distinct functional specifications.

| Clock configuration | Logic period | RX period | TX period |
|---|---:|---:|---:|
| A | 10 ns | 8 ns | 8.6 ns |
| B | 7.4 ns | 10.6 ns | 6.2 ns |

All three clocks have different initial phases. The non-125 MHz GMII frequencies are simulation stress configurations for clock-domain crossing, **not measured gigabit line-rate performance**. Three `sync_reset` instances provide asynchronous assertion and release after three respective domain clock edges.

Python generates packet bytes using Internet checksums and CRC32. The negative control changes exactly one expected FCS bit in the first outgoing ARP frame; acceptance requires `GMII_BYTE_MISMATCH frame=0 byte=71` and absence of the success marker, regardless of XSim's process exit code.

Run from the workspace root:

```powershell
python projects/hard-bench/ethernet-cdc/generate.py
python projects/hard-bench/ethernet-cdc/run.py a
python projects/hard-bench/ethernet-cdc/run.py b
python projects/hard-bench/ethernet-cdc/run.py negative
```

`result-a.json`, `result-b.json`, and `result-negative.json` point to raw native-tool artifacts; `runs/` retains every attempt. `manifest.json` records upstream revision, source/vector SHA256 hashes and exact counts. `result.json` is the final aggregate receipt. Other model API calls: **0**.

Final simulation wall times including compile/elaboration: A **68.67 s**, B **62.79 s**, negative control **65.47 s**. Coordinated physical implementation took **161.2 s**. `input-hashes-final.json` also freezes testbench/generator and constraint inputs. An independently written bit-by-bit CRC and checksum audit by the coordinating agent is at `artifacts/hard-bench-assessment-20261023/network-oracle-audit.json`.

The upstream IPv4 receiver checks version/IHL/checksum but does not reject an impossible `total_length` before emitting data. The added length guard marks such frames bad and an intermediate frame FIFO discards them before the IP parser. RX UDP checksum verification is **not implemented or claimed**. No PHY, physical network, hardware board, saturation throughput, or arbitrary reset-during-TX behavior has been tested.

`implement.tcl` targets an Artix-7 `xc7a100tfgg676-2` OOC design with logic at 100 MHz and independent RX/TX clocks at 125 MHz. `constraints.tcl` preserves the upstream FIFO Gray-pointer maximum-delay and bus-skew constraints, reset synchronizer exceptions and explicit MAC status synchronization constraints. It deliberately avoids blanket asynchronous clock groups that would override these checks. The flow produces detailed CDC, bus-skew, ignored-exception, exception-coverage, timing and route reports. **Physical/CDC acceptance requires review of these reports; generating them alone does not prove safe CDC.** Implementation is launched only by the coordinating agent.

Verification history: the initial two clock runs passed packet/fault/reset checks but showed no MAC RX backpressure. An explicit four-frame pause also failed the new coverage gate (`No actual MAC RX backpressure observed`); the buffers absorbed that burst. The final stimulus uses an eight-frame paused burst and requires actual stalls. Earlier attempts remain in `runs/` and do not count toward final coverage.
