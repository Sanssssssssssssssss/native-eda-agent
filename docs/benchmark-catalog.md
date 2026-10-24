# Benchmark catalog and reproduction

`benchmarks/catalog.json` contains **77 entries in 57 families**. The generated RTL portion is **12 families × 2 widths = 24 variants**, with 40 deterministic vectors per variant. These are local regression exercises, not 24 independent external benchmark problems. Historical results are never imported as current scores.

| Tier | Entries | Scope |
|---|---:|---|
| smoke | 3 | Counter, RC AC and RC transient |
| light | 61 | 24 generated RTL variants, 32 existing VerilogEval tasks, 2 rejection controls, 2 trace/benchmark contracts, 1 deliberate timeout |
| system | 5 | SoC, DMA, UDP, AES and FFT simulation |
| implementation | 6 | Counter, four system designs and FFT at 100 MHz OOC |
| external | 2 | Explicit unintegrated external placeholders; no score |

The VerilogEval selections contain 8 and 24 unique upstream task IDs, with no overlap: **32 distinct upstream tasks**. Simulation and implementation entries for one design share a family. The 77 entries include controls and external placeholders and therefore are not a count of independent scored problems.

Catalog `2026-10-23.2` corrects the classifications of `Prob068_countbcd` to sequential RTL and `Prob137_fsm_serial` to FSM. Earlier `2026-10-23.1` campaigns retain their frozen catalog; comparison reports a catalog mismatch across these versions.

Categories cover combinational RTL, sequential RTL, FSMs, protocols, buses, memory, arithmetic, DSP, systems, analog, tool errors, timeout, trace and reproduction. A case has a stable `id`, `family`, `variant`, `seed`, `origin`, tier, tool, input adapter and acceptance policy. `existing` means a local entry already existed; it does not mean this campaign ran it. `generated` records local generation. External placeholders remain blocked.

## Commands

```powershell
node scripts/benchmark.mjs validate
node scripts/benchmark.mjs list --category memory
node scripts/benchmark.mjs plan --tier light
node scripts/benchmark.mjs run --ids counter,rc-ac,gen-adder-w4,gen-fifo-w4 --concurrency 2
node scripts/benchmark.mjs run --tier light --concurrency 2
node scripts/benchmark.mjs report artifacts/benchmark-RUN
node scripts/benchmark.mjs compare artifacts/benchmark-BASELINE artifacts/benchmark-CANDIDATE
```

`list` shows every matching entry. `plan` and `run` select the three smoke cases when no selection filter is supplied. `category`, `tier`, `tool` and `ids` accept comma-separated values; filters intersect. Unknown values are errors. `--seed` overrides the recorded seed. A run creates a new artifact directory and never rewrites an earlier result.

The JavaScript entry is `src/bench/index.mjs`: `loadCatalog`, `validateCatalog`, `listCases`, `planBenchmark`, `runBenchmark`, `reportBenchmark` and `compareRuns`. `runBenchmark` returns a JSON-compatible summary and accepts an `AbortSignal`. Native EDA calls use the same registered tools as the Agent and MCP. No model session or model API request is made.

## Execution and evidence

Simulation scheduling defaults to 2 concurrent cases and accepts 1–4. Implementation scheduling allows 1. The shared runtime can impose tighter cross-process limits. Per-case deadlines include queue waiting and execution. Cancellation is propagated to the actual native tool. Waveform logging is not requested; a simulator may still create its own metadata files.

Each campaign retains:

- `plan.json`, a catalog snapshot, `events.jsonl`, `summary.json` and a short `REPORT.md`.
- Per-case arguments, generated inputs, frozen oracle vectors, source hashes and acceptance hashes in `before-run.json`.
- Per-case `result.json`, orchestration trace, native tool receipt, native process records and raw log paths.
- UTC start/end times, durations, family/variant/seed, catalog version, parent run/span context and model usage scope.

Snapshots use the common trace storage. Only referenced input files are captured; the catalog does not duplicate entire vendor repositories or prior waveform directories. FFT uses an isolated Tcl copy that removes the original `latest-*.txt` writes and explicit `log_wave` calls. VerilogEval uses the existing XSim declaration adapter and preserves the original watchdog; waveform statements are removed. Adaptations and original inputs are recorded.

`tool_exit` is the final **real child-process exit code**, not an invented CLI exit code. An input rejected before launching any child has `tool_exit: null`, `tool_status: failed`, and a separate failed tool-call result. Tool success and design acceptance are separate fields.

| Acceptance | Meaning |
|---|---|
| PASS | Completed invocation and its frozen semantic acceptance both succeeded |
| EXPECTED_FAILURE | A labelled negative control failed for its required reason |
| EXPECTED_TIMEOUT | A labelled watchdog control timed out; its `passed` field remains false |
| FAIL | Tool failure or semantic mismatch |
| TIMEOUT | Real process deadline or simulation watchdog; never PASS |
| INCOMPLETE | Missing completion evidence, cancellation, input drift or failed snapshot integrity |
| BLOCKED | Missing inputs or an external placeholder |

Generated DUTs use frozen numeric expectations calculated by JavaScript reference models. Their testbenches compare actual values, reject X/Z through case inequality, and require all 40 checks. The DUT and testbench both declare a timescale. RC checks use analytical equations with 0.2% relative tolerance. VerilogEval requires a positive sample count, zero mismatches and no timeout. Implementation requires routed evidence and nonnegative setup/hold slack at 10 ns. FFT also requires the existing independent NumPy oracle.

## Comparing iterations

Comparison checks case identity, catalog version/content, task/test input hashes, generator hash, seed, acceptance code/policy and tool environment. Missing evidence, unresolved dependencies or changed rules produce `INCOMPARABLE` with reasons.

Candidate design files have a separate hash. A changed candidate remains comparable when its task, tests and acceptance remain fixed; the result explicitly marks `candidate_changed`. Runtime source changes are warnings. Generated run-local paths are normalized to logical case-relative names, so a fresh directory does not itself make a replay incomparable. Timing deltas are observations rather than isolated performance measurements.

`report` and `compare` are read-only. To preserve a comparison, redirect their output to a new artifact file. Existing fixtures and legacy project `latest` pointers are never changed by benchmark execution.

`auditCampaign(runDirectory)` in `src/bench/audit.mjs` derives queue wait, native process time, trace/span linkage, snapshot validity and acceptance consistency from retained evidence. Save its return value as a new `derived-audit.json` beside the original summary. Summed case timings overlap under concurrency; queue wait is not simulator performance. Retry campaigns retain their own summaries and do not replace original failures.

## Validation boundary

`tests/benchmark.test.mjs` exercises false pass rejection, timeout/cancellation semantics, negative controls, analytical RC acceptance, deterministic generators, concurrency limits, comparable/incomparable iterations and FFT isolation. The tests run without EDA or model calls. Real EDA outcomes belong to individual campaign receipts; catalog availability and offline generator tests do not prove a simulation passed.

Static dependency discovery cannot fully resolve arbitrary dynamic Tcl/Verilog expressions. Such gaps are recorded and prevent an unqualified reproduction comparison. This catalog does not claim formal proof, board timing, physical hardware operation, external benchmark representativeness or complete toolchain packaging.
