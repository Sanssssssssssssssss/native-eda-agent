# Harder system integration campaign

Final: **3/3 functional, 3/3 fault-detection controls, 3/3 routed OOC timing passes**. See the [Chinese score report and real Vivado screenshots](../../docs/history/hard-system-projects-2026-10-23.md) and machine-readable audit (local/optional evidence; see results/catalog.json).

Three new integrations, developed concurrently by the current Codex session and three subagents. Only local XSim/Vivado and local software oracles are invoked; no separate model API is called.

| Project | Integration challenge | Required evidence |
|---|---|---|
| `axi-fabric` | Three AXI4 masters, three targets, shared crossbar | Multiple outstanding requests, simultaneous masters, IDs, independently stalled channels, scoreboard, SLVERR/DECERR recovery |
| `ethernet-cdc` | GMII MAC, asynchronous frame FIFOs, Ethernet/IP/ARP/UDP | Independent clocks, complete frame/FCS oracle, good/bad frame recovery, CDC constraints and report |
| `crypto-soc` | RV32IM firmware, descriptor AES-CTR DMA, shared memory | Real firmware doorbells and IRQs, CPU/DMA contention, chained jobs, independent cryptography oracle, error recovery |

The target is Artix-7 `xc7a100tfgg676-2`. Single-clock designs target 100 MHz; the Ethernet design defines each clock separately. Physical implementations run one at a time because this machine is under memory pressure. Each project keeps its own receipts and previous failures.

Counts of transactions, seeds, bytes and negative cases describe coverage within a project. They do not increase the number of projects. Functional, fault-detection, routing and timing acceptance are reported separately. This is an integration and repair exercise with visible testbenches, not an unseen benchmark or pass@1 measurement. No board execution is claimed.

Framework and trace documentation: [agent-framework-and-traces.md](../../docs/agent-framework-and-traces.md). Prior four-project results remain in [system-projects-2026-10-23.md](../../docs/history/system-projects-2026-10-23.md).
