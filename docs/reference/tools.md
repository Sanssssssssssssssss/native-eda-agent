# Native tool contracts

57 native interfaces. 28 are focused contracts over shared executors; 4 expose retained scores. Community MCP separately exposes 45 tools and 11 prompts.

Schemas: [tools.json](tools.json). Real EDA calls write independent artifacts and use shared resource leases.

| Tool | Executor | Runs EDA | Purpose |
|---|---|---|---|
| `eda_xsim` | `eda_xsim` | Yes / see schema | Compile Verilog/SystemVerilog and VHDL, elaborate a testbench and run bounded XSim. Supports include directories, defines, top parameters, libraries, plusargs and SV seed. Optional literal pass_marker yields an explicit verdict; fatal/error/timeout overrides it. Without a marker functional acceptance remains unevaluated. |
| `eda_vivado` | `eda_vivado` | Yes / see schema | Execute an authored Vivado Tcl script in a new output directory. Explicit dependencies freeze dynamic Tcl/IP inputs that automatic discovery cannot resolve. Supports synthesis and implementation; returns evidence, not an assumed pass verdict. |
| `eda_ltspice_batch` | `eda_ltspice_batch` | Yes / see schema | Run a self-contained .cir/.net netlist with the real LTspice batch engine and return its .log measurements. Copies the input into a fresh artifact directory. For external models use absolute .include paths or the official LTspice MCP in the original project directory. |
| `eda_verify` | `eda_verify` | No | Check the provided counter and RC examples against fixed behavioral and mathematical acceptance criteria. Accepts artifact directory paths and one combined analog log. The result is computed independently of the model. |
| `eda_vivado_catalog` | `eda_vivado_catalog` | Yes / see schema | Query the installed Vivado version, available commands, parts or IP VLNVs. Bounded results include total match count; availability is not execution proof. |
| `eda_vivado_synthesize` | `eda_vivado_synthesize` | Yes / see schema | Synthesize explicit RTL/XCI sources and XDC into a fresh checkpoint. Supports include directories, defines and top parameters. Defaults to out-of-context; no implicit clocks or timing relaxation. Produces utilization and black-box evidence. |
| `eda_vivado_implement` | `eda_vivado_implement` | Yes / see schema | Open a synthesis checkpoint, apply explicit XDC and frozen Tcl constraint scripts, and run opt/place/route. Declared asynchronous reset exceptions require a routed netlist audit of every leaf load and at least two release stages per clock. Tool completion is separate from board signoff. |
| `eda_vivado_reports` | `eda_vivado_reports` | Yes / see schema | Generate selected timing, CDC, DRC, methodology, clock, exception, route and utilization reports from a checkpoint. Unknown report formats remain unknown; CDC warnings and missing IO constraints require review. |
| `eda_vivado_objects` | `eda_vivado_objects` | Yes / see schema | Inspect bounded matching cells, nets, ports, pins or clocks in a checkpoint. Returns names and selected properties plus total count; query text is passed as data, never evaluated as Tcl. |
| `eda_vivado_timing_paths` | `eda_vivado_timing_paths` | Yes / see schema | Return setup or hold timing paths with endpoint, slack, requirement and logic depth. Optional from/to clock names must resolve exactly. A bounded path listing does not establish whole-design TNS or signoff. |
| `eda_vivado_find_parts` | `eda_vivado_catalog` | Yes / see schema | Find installed parts; starts Vivado, returns bounded matches. |
| `eda_vivado_find_ips` | `eda_vivado_catalog` | Yes / see schema | Find installed ips; starts Vivado, returns bounded matches. |
| `eda_vivado_find_commands` | `eda_vivado_catalog` | Yes / see schema | Find installed commands; starts Vivado, returns bounded matches. |
| `eda_vivado_report_timing` | `eda_vivado_reports` | Yes / see schema | Generate timing evidence from an immutable input DCP in a fresh run. Report warnings require review. |
| `eda_vivado_report_utilization` | `eda_vivado_reports` | Yes / see schema | Generate utilization evidence from an immutable input DCP in a fresh run. Report warnings require review. |
| `eda_vivado_report_cdc` | `eda_vivado_reports` | Yes / see schema | Generate cdc evidence from an immutable input DCP in a fresh run. Report warnings require review. |
| `eda_vivado_report_drc` | `eda_vivado_reports` | Yes / see schema | Generate drc evidence from an immutable input DCP in a fresh run. Report warnings require review. |
| `eda_vivado_report_methodology` | `eda_vivado_reports` | Yes / see schema | Generate methodology evidence from an immutable input DCP in a fresh run. Report warnings require review. |
| `eda_vivado_report_clocks` | `eda_vivado_reports` | Yes / see schema | Generate clocks evidence from an immutable input DCP in a fresh run. Report warnings require review. |
| `eda_vivado_report_exceptions` | `eda_vivado_reports` | Yes / see schema | Generate exceptions evidence from an immutable input DCP in a fresh run. Report warnings require review. |
| `eda_vivado_report_route` | `eda_vivado_reports` | Yes / see schema | Generate route evidence from an immutable input DCP in a fresh run. Report warnings require review. |
| `eda_vivado_query_cells` | `eda_vivado_objects` | Yes / see schema | Query cells with bounded output and total count. Patterns are Tcl data. |
| `eda_vivado_query_nets` | `eda_vivado_objects` | Yes / see schema | Query nets with bounded output and total count. Patterns are Tcl data. |
| `eda_vivado_query_ports` | `eda_vivado_objects` | Yes / see schema | Query ports with bounded output and total count. Patterns are Tcl data. |
| `eda_vivado_query_pins` | `eda_vivado_objects` | Yes / see schema | Query pins with bounded output and total count. Patterns are Tcl data. |
| `eda_vivado_query_clocks` | `eda_vivado_objects` | Yes / see schema | Query clocks with bounded output and total count. Patterns are Tcl data. |
| `eda_vivado_setup_paths` | `eda_vivado_timing_paths` | Yes / see schema | Inspect worst setup paths. This is not whole-design signoff. |
| `eda_vivado_hold_paths` | `eda_vivado_timing_paths` | Yes / see schema | Inspect worst hold paths. This is not whole-design signoff. |
| `eda_vivado_optimize` | `eda_vivado_optimize` | Yes / see schema | Provider-free RouteAgents routing plus bounded Vivado candidate loop and AER plateau stopping. Default plan measures a routed DCP; run tries physical recipes. resume_from continues an interrupted run from a verified committed journal in a fresh directory after baseline/winner remeasurement; run recovery-check first. Preserves constraints, logical representation, routing/hold/DRC gates; reports gain and rejections. No formal/board signoff. Shared lease and causal traces. |
| `eda_knowledge` | `eda_knowledge` | No | Rank local FPGA rules using English terms and Chinese bigrams, or retrieve an exact rule ID. Returns source versions, applicability, required evidence and corpus hashes. Lexical retrieval only; no embeddings, model or internet call. |
| `eda_sop` | `eda_sop` | No | List local FPGA SOPs or load one by ID with its full procedure, referenced rules, required evidence and file hashes. Guidance is advisory; declared workflow checks enforce acceptance. No EDA or model call. |
| `eda_trace` | `eda_trace` | No | Offline inspect, recovery-check or OTLP JSON export for native/proxy/optimizer traces. Checks hashes, parents, committed state and ownership. Export writes a local file only; never uploads, resumes EDA or infers functional acceptance. |
| `eda_runs` | `eda_runs` | No | List persistent runtime jobs. Explicit reconcile archives leases only when their owner and recorded children are absent; never kills or reruns a job. |
| `eda_preflight` | `eda_preflight` | No | Inspect local EDA capability paths, runtime configuration and model API policy. Availability is not a successful validation. |
| `eda_benchmark` | `eda_benchmark` | Yes / see schema | List, plan, execute, report or compare versioned local benchmarks. Real EDA runs use global resource limits, frozen acceptance and per-case traces. Seeds are variants, not independent tasks. |
| `eda_trace_inspect` | `eda_trace` | No | Inspect hashes, span lineage and terminal evidence; no EDA execution. |
| `eda_trace_export` | `eda_trace` | No | Export terminal spans to a local OTLP JSON file; no upload. |
| `eda_trace_recovery_check` | `eda_trace` | No | Check durable optimizer recovery eligibility and process ownership; does not resume. |
| `eda_runs_list` | `eda_runs` | No | Read persistent run states and counts. |
| `eda_runs_reconcile` | `eda_runs` | No | Release stale leases only after owner and child processes are absent; never terminate a process. |
| `eda_benchmark_list` | `eda_benchmark` | No | List cases and execution prerequisites. |
| `eda_benchmark_plan` | `eda_benchmark` | No | Resolve a frozen campaign without starting EDA. |
| `eda_benchmark_run` | `eda_benchmark` | Yes / see schema | Execute a frozen campaign with shared leases and per-case receipts; starts EDA. |
| `eda_benchmark_report` | `eda_benchmark` | No | Read a retained campaign; failures and timeouts remain in the denominator. |
| `eda_benchmark_compare` | `eda_benchmark` | No | Compare campaigns only when case acceptance and test inputs are compatible. |
| `eda_results_list` | `eda_results_list` | No | List retained historical scorecards with original protocols and units. Does not run EDA. |
| `eda_results_get` | `eda_results_get` | No | Read one historical scorecard, limitations and public/original evidence hashes. |
| `eda_results_verify` | `eda_results_verify` | No | Verify packaged evidence hashes and available local originals. Missing original artifacts are reported, never treated as reproduced. |
| `eda_results_compare` | `eda_results_compare` | No | Compare historical scores only if task population, protocol, scope, units and evidence integrity match. |
| `eda_workflow_plan` | `eda_workflow_plan` | No | Resolve a frozen sequential task, input hashes, tool dependencies and budget without starting EDA. |
| `eda_workflow_run` | `eda_workflow_run` | Yes / see schema | Execute declared steps with shared tool leases, fixed acceptance checks and a cumulative budget. May start EDA. Stops on the first failed check. |
| `eda_workflow_inspect` | `eda_workflow_inspect` | No | Read task checkpoints and verify committed child traces, result files and output hashes. |
| `eda_workflow_resume_check` | `eda_workflow_resume_check` | No | Read-only check of task ownership, frozen inputs, implementation, completed results and remaining budget. |
| `eda_workflow_resume` | `eda_workflow_resume` | Yes / see schema | Continue an eligible task in a new trace, reusing verified completed steps. An interrupted uncommitted step is rerun; no exactly-once guarantee. May start EDA. |
| `eda_task_context` | `eda_task_context` | No | Prepare ranked rules, phase-selected SOPs and their actual tool contracts. Optionally revalidate a workflow and attach domain outcomes, evidence citations and recovery advice. No model or EDA execution. |
| `eda_task_prepare` | `eda_task_prepare` | No | Freeze an existing independent verification contract and copy declared inputs into an isolated runnable RTL candidate. Static; no model or EDA dispatch. Returns a task directory for the host session. |
| `eda_task_inspect` | `eda_task_inspect` | No | Recheck candidate, immutable inputs, latest independent verdict, owner and cumulative retry budget. Does not execute EDA or resume a model. |
