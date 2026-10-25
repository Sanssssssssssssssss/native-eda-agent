# AMD Ross integration

The pinned AMD source contributes **49 skills and one shared script directory**. Pi and the project Codex skill catalog use `.agents/skills`; the original source remains under `vendor/ross-ai-assistant`. All 1,149 copied files match the pinned source. Skills are guidance; this count is not an MCP tool count.

| Item | Current evidence |
|---|---|
| Source | `Xilinx/ross-ai-assistant`, `2cdc9eef1b6b5b17fa45f5e4d468e5483a1c92de`, 2026.9.1 |
| Pi loader | 49 Ross + 4 existing skills, no duplicate-name diagnostics |
| Codex project skills | 49 skills installed; available on the next turn/session refresh |
| Official Ross MCP | **Not connected**; executable not downloaded |
| Download | Official Windows 2026.9.1 package, approximately 19.25 MB; AMD account download page requires a working browser session |
| Local Vivado | 2020.2; real probe found `webserver`, `synth_design`, `report_cdc`, `write_checkpoint` |
| Compatibility limit | Command presence is not a Ross handshake or 2026.1 skill compatibility test |
| Additional model API calls | 0 |

Configuration: `.eda/ross.json`; guarded launcher: `scripts/ross-mcp.mjs`; project MCP registration: `.codex/config.toml` (Ross disabled until validated). Existing `eda-local` is enabled and was recognized by Codex CLI.

```powershell
node scripts/check-ross.mjs
node scripts/ross-mcp.mjs
```

The second command currently exits with `ROSS_BINARY_MISSING`. Obtain the official package from [AMD Downloads](https://www.amd.com/en/support/downloads/ross-agentic-ai.html), save it as `runtime/ross/vivado-mcp-server-windows-amd64-2026.9.1.exe`, inspect its signature/hash, then validate `tools/list` and a real owned Vivado session before enabling the configuration. The documented baseline is Vivado 2026.1; keep release-specific lint, Vitis, Versal and hardware operations gated by their actual prerequisites.

Receipts: `artifacts/ross-integration/skills.json`, `source-verification.json`; successful command probe: `artifacts/2026-10-23T16-18-26-184Z-eda_vivado-1f4e31bd`. The first probe failed because Vivado 2020.2 rejects `help -file`; its evidence remains at `artifacts/2026-10-23T16-17-04-930Z-eda_vivado-c3f712ad`. The probe was corrected to print help into the captured process log.

The network skill-installer stalled and was stopped; installation used the already pinned local source, including shared HLS scripts and the AMD license. Existing platform regression passed: 62 Node tests, 12 Python tests, plus measurement-verifier checks. No synthesis/route benchmark was rescored during this integration.

The independent Synopsys/HiPilot project lives at `E:\GPTProject2\SynopsysAgent`; see its `README.md`. Existing [framework and traces](../agent-framework-and-traces.md) and [parallel collaboration](parallel-coordination-2026-10-23.md) remain applicable.
