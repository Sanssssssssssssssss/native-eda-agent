# EDA workspace

Use Chinese unless requested otherwise. Read `.eda/config.json`: model provider APIs are currently disabled. Local tools, knowledge lookup and offline checks remain available. Respect current user scope and authorization; never read or persist credentials. Do not launch vendored model optimizers. Report other-model API calls separately from unknown outer Codex usage.

## Choose guidance and freeze the task

Start with `eda_preflight` and `eda_runs action=list`. Establish the top, part, clocks/resets, interfaces, RTL/XDC/DCP inputs and fixed acceptance. Use `eda_knowledge` for ranked Chinese/English rules; inspect source versions, scope and required evidence. Use `eda_sop` for the full planning, RTL verification, timing triage or reproduction procedure. Planning, verification, timing, reproduction, CDC and IP integration make six bundled skills. These skills also load through Pi's resource loader. Optional Ross skills appear only when installed; session `resources_loaded` records what was actually discovered. See `docs/knowledge-and-sops.md`.

Use `eda_task_context` to select phase-relevant rules/SOPs and actual tool contracts. With a workflow directory it revalidates observations; unknown or stale observations must not become successful design conclusions.

For multi-tool tasks use `docs/workflows.md`: declare inputs, selected `guidance.rule_ids/sop_ids`, per-step checks, a typed `acceptance` profile with domain bindings, and cumulative budgets. `eda_workflow_plan` is static. `run/resume` executes the declared tools; selecting guidance freezes its content but step checks and bound domain evaluators enforce acceptance. Freeze testbenches, seeds, constraints and inputs before optimization. Never weaken them to improve a score. Use one native/MCP route per operation to avoid duplicate runs.

## Execute and verify EDA

The native registry supports Codex, CLI, Pi and `eda-local` MCP. Shared resource limits are XSim 2, Vivado 1 and LTspice 1. Calls keep fresh `artifacts/` directories and trace. Tcl receives `EDA_WORKSPACE`; limit Vivado threads with `set_param general.maxThreads 2`. Arbitrary Tcl must wait for all asynchronous jobs before releasing its resource lease.

Prefer typed FPGA contracts from `docs/reference/tools.md`: catalog, synthesis, implementation, reports, objects and setup/hold paths. `eda_xsim` supports explicit HDL files, include dirs, defines, generics, libraries, plusargs and seeds. Require a meaningful literal `pass_marker`; preserve parameters and timeouts for each case. Capture waves only when useful to the current debug question. IP-generated simulation models/custom libraries must be exported or supplied explicitly; the typed source list does not discover them. Use `eda_vivado` for authored Tcl when the typed operations do not fit.

Treat simulation, synthesis, setup/hold, constraints, routing, CDC, DRC, formal proof and board tests as separate results. Missing report fields remain unknown. DRC report generation does not prove zero violations. Never program a board without a user request. For analog work, `eda_ltspice_batch` and the optional official LTspice MCP expose execution; inspect numeric measurements and compare to an independent reference before acceptance. Counter core OOC success does not resolve the original board-I/O timing failure. LTspice RC AC and transient examples use separate netlists.

The community proxy exposes persistent sessions and project/IP/BD operations. See `projects/native-vivado-workbench/README.md`: `wb_*` requires absolute workspace paths and explicit project/BD identifiers; failed mutations may be partial. Inspect `_meta["eda.trace"]`, receipts and output logs. Start owned sessions in Tcl mode unless GUI is requested; close them after use. Timeout/cancellation closes the proxy-owned backend; reconnect before reuse. Configuration changes also require reconnecting. The real LTspice bridge has not been revalidated after proxy changes.

`eda_vivado_optimize` uses seven local physical strategies, a pure feature router, budgets, candidate admission and winner recheck. Both `mode=plan` and `mode=run` start real Vivado. Static-only requests must inspect files/traces instead. Preserve interface/netlist/constraint fingerprints; report every rejection, `input_unchanged`, `winner_recheck` and actual gain. Exported logical equality is not formal equivalence. Only two reroute strategies have live validation, with zero gain in that historical run. The 42-play upstream catalog is reference material, not 42 verified implementations.

## Inspect, recover and report

Use `eda_trace` before delivery. Inspect terminal outcome, snapshots, failures, acceptance and remaining work; `completed` describes execution only. Trace records observable decisions and evidence, never inferred model thoughts. Historical events must not be backfilled.

Workflow recovery uses `eda_workflow_resume_check` before `resume`; it verifies owners, frozen inputs/code, completed results and artifacts, then continues in a new directory. Optimizer recovery uses `eda_trace action=recovery-check` and `resume_from`, remeasuring baseline and committed best. Legacy four-tool replay is a separate path. Do not infer process death from elapsed time or terminate unrelated jobs. Preserve failed runs. Three unchanged failures in a recovery chain stop further resume; diagnose before a new task. Separate task_acceptance from execution status. See `docs/agent-workflow-and-trace-contract.md` and `docs/agent-framework-and-traces.md`.

OTLP export writes local files by default. Upload only when the user explicitly requests transmission to a specified receiver. Historical score comparisons require the same task set, protocol, scope and unit. Keep historical achievements, current software verification, model/API cost and unaccepted items distinct.

Optional AMD Ross skills target newer versions; local baseline is Vivado 2020.2. Check exact command availability and prerequisites before using Vitis AI, Versal, hardware-debug or newer lint/coverage skills. The official Ross MCP binary requires separate installation and is not connected by the batch adapter. Do not describe missing optional skills or servers as loaded capabilities.
