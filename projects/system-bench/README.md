# System project evaluation

Four pinned public designs, integrated and tested locally by the current Codex session and three Codex subagents. No separate model API is used.

The separate chat `[local-session-id]` also contributed framework tracing, baseline regression, replay/evidence tooling and independent result checks. See [Agent framework and traces](../../docs/agent-framework-and-traces.md) and [collaboration record](../../docs/parallel-coordination-2026-10-23.md). This campaign's usage snapshot covers its root and three child sessions; it excludes that separate chat and its subagents.

| Project | Functional acceptance | Physical implementation |
|---|---|---|
| RV32IM SoC | Compiled C firmware, runtime input, CRC32, sorting, matrix multiply, byte/halfword RAM access, interrupts, bus stalls | Artix-7, 100 MHz, out of context |
| AXI DMA | Read/write descriptors, unaligned bytes, burst and 4 KiB boundaries, backpressure, AXI response errors | Same device and clock |
| UDP/IP/ARP | Ethernet frame input/output, ARP resolution, UDP payload/checksum, malformed IPv4 rejection, backpressure | Same device and clock |
| AES stream engine | AES128/256 encrypt/decrypt, input/output FIFOs, key barriers, independent software oracle, reset and backpressure | Same device and clock |

Results are integration tests of existing cores, not a blind code-generation benchmark. Counts of vectors or transactions do not represent independent projects. OOC timing does not establish board I/O timing or hardware operation.

Pinned sources: PicoRV32 `ef203c2b0a3fb793280f5114941416c425c5b461` (ISC), verilog-axi `516bd5dadc3365b7f9e225d2af8fe0b8d804fe53` (MIT), verilog-ethernet `77320a9471d19c7dd383914bc049e02d9f4f1ffb` (MIT), secworks/aes `80dc4718e1dcbbdb4b0dd1bdb393d8f7b98981dc` (BSD-2-Clause). PicoRV32 is archived; the two Alex Forencich libraries are superseded by Taxi. These are reproducibility choices for Vivado 2020.2, not claims of current upstream maintenance.

From the workspace root, run `python projects/system-bench/run.py <soc|dma|udp|aes> <sim|impl>`. Each run uses a new artifact directory and saves `latest-sim.json` or `latest-impl.json`. A zero XSim process exit is insufficient: the runner also requires the project PASS marker and rejects fatal/timeout messages.

Functional simulations can run concurrently. On this 32 GB machine, leave memory headroom and run one physical implementation at a time: Vivado initialization intermittently failed to read existing Tcl installation files during this experiment, including one attempt without a second batch job. The root cause remains unconfirmed. GUI checkpoints also consume substantial memory.

`collect_results.py` collects source hashes, actual elaborated module types, strict functional verdicts, and physical resource/timing reports. `collect_usage.py` exports numeric usage from the four known Codex session ledgers. See the final Chinese report in `docs/system-projects-2026-10-23.md`.
