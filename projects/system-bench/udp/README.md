# UDP / IPv4 / ARP system evaluation

Functional simulation passes: **65 transmitted and 65 received UDP packets**, **62,272 payload bytes checked**, two malformed IPv4 cases repeated eight times each rejected, ARP retry/timeout and idle reset recovery checked. The byte oracle comes from Python Internet-checksum calculations, independently of the Verilog implementation.

Physical implementation also passes at the specified 100 MHz OOC constraint: **setup slack +1.899 ns, hold slack +0.075 ns**, 1,599 physical Slice LUTs, 2,924 flip-flops, one RAMB36 and no DSP. All 3,779 routable nets are routed with zero routing errors. Successful implementation took 120.19 seconds; successful final simulation took 26.47 seconds. Resource values come from `utilization.rpt`, not the LUT primitive count in the JSON helper.

The design compiles 20 files / 8,159 RTL lines: 19 pinned upstream files plus the integration wrapper. Upstream is `alexforencich/verilog-ethernet` at `77320a9471d19c7dd383914bc049e02d9f4f1ffb`, MIT; upstream files are unchanged. This is a tested integration of existing cores, not a blind RTL-generation benchmark.

| Scenario family | Verification |
|---|---|
| Bidirectional packet transport | 64 baseline vector entries covering 61 distinct payload lengths from 1 to 1,472 bytes; 2, 8 and 32 bytes each occur twice. Simultaneous TX/RX after first exchange; UDP payload bytes and packet boundaries checked |
| Generated IPv4 and UDP checksums | Entire outgoing IP packet compared to the Python byte oracle |
| AXIS backpressure | Deterministic random stalls; valid, data, last and user must remain stable during stalls |
| Cold / cached ARP lookup | First packet triggers one request; next 63 packets use the cache |
| ARP responder | Peer request produces a reply; selected ARP format, source MAC/IP and opcode fields checked |
| Invalid IPv4 checksum | One malformed frame repeated 8 times produces exactly 8 errors and no UDP outputs |
| Truncated IPv4 header | One truncated-header case repeated 8 times produces exactly 8 errors and no UDP outputs |
| ARP timeout | 4 unanswered requests produce one timeout error and no leaked IP packet |
| Reset recovery | Reset while idle after timeout, then repeat cold lookup, one transmit, and one receive; no reset during an active transfer |

The nine rows are verification families. They overlap the same packet transactions and must not be added to packet count as independent benchmark tasks. The 65 packets in each direction comprise 64 baseline packets and one reset-recovery packet.

The complete outgoing IPv4/UDP packets use byte comparison. ARP checks cover selected key fields and expected request/reply counts; they do not compare every ARP field against a complete byte oracle. The 16 malformed IPv4 inputs represent two fault cases with eight repetitions each.

The negative control flips one bit in the expected IPv4 header checksum. XSim is required to report `TX mismatch packet=0 byte=10` and must not print the completion marker. It was rejected as intended even though XSim itself returned process exit 0.

Reproduce from the workspace root:

```powershell
python projects/system-bench/generate_udp.py
python projects/system-bench/run.py udp sim
python projects/system-bench/udp/negative_control.py
python projects/system-bench/run.py udp impl
```

`latest-sim.json`, `negative-result.json`, and `latest-impl.json` point to raw receipts. The successful simulation records 94,883 clock cycles and runs to 948.83 microseconds. `manifest.json` records vector hashes, lengths, and exact coverage.

Scope: Ethernet frame interface, without MAC, PHY, Ethernet FCS, external network traffic, or board testing. This upstream receiver exposes the received UDP checksum but does not validate it; the tests verify generated outgoing checksums and malformed **IPv4** rejection. ARP timeout intervals are shortened to 1,000 / 2,000 cycles in the tested wrapper. Physical implementation is OOC on `xc7a100tfgg676-2`, 100 MHz with 2 ns input/output delay; it does not establish board timing closure.

The OOC clock port has no `HD.CLK_SRC` placement property, so Vivado cannot estimate the top-level clock delay/skew. The reported positive slack is internal OOC evidence, not board clock signoff.

Two initial physical-build attempts failed while Vivado tried to read existing installation Tcl files. A subsequent isolated launch completed synthesis, placement and routing. The local build uses `synth.maxThreads=1`; no Vivado installation files were changed. Other project runs also saw an isolated-launch failure, so concurrency alone does not explain these intermittent file-read errors; the root cause is not established.

The first simulation exposed an error in the testbench's frame-header/payload pairing under backpressure. The sink now accepts a header before enabling that frame's payload. The first failed log is retained; no upstream RTL was changed for this correction.
