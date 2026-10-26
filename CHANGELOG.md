# Changelog

## Unreleased

- Qualified eight existing FPGA projects on A7-100T with fixed functional checks, synthesis, setup/hold, constraints, routing and zero DRC. Seven use native Pi sessions and host verification; FFT uses the native tool pipeline. Retained failed attempts and cumulative budgets separately from final passes.
- Fixed Tcl constraint execution, netlist-verified asynchronous reset exceptions, routed-checkpoint report readback and AES compilation ordering. Added explicit native Tcl dependencies and visible I/O/reset evidence. Offline acceptance passes 301 tests; seven final sessions pass independent online evidence assessment. See [results](docs/a7-eight-projects.md).

- Stabilized native Pi sessions against CommandCode and real XSim/Vivado workflows: use upstream Pi 1.4 worker queuing, reject unrecovered output truncation before verification, and preserve native compaction/retry behavior.
- Replaced incomplete shared JSON Schema validation with pinned TypeBox; fixed confirmed cancellation status and UTF-8 decoding across HTTP and ACE process chunks.
- Count online evaluations by session/workflow subject and retain failed/unbound history. Added a separately versioned AXI internal protocol checker after a mutation exposed a historical checker gap; prior scores retain their original protocol.
- See the [stability campaign](docs/stability-2026-10-26.md) for bounded live repairs, cancellation/recovery, failures, offline regressions and usage accounting.

- Bound native model tool requests, including nested and denied calls, and stop at the request boundary after cancellation or budget exhaustion. Disabled auxiliary codemode model access; verified dispatch with real Pi SDK and local scripted responses.
- Record session execution provenance and require it for online evaluation. Reject incomplete, skipped or duplicate lifecycle coverage; preserve terminal receipts after unsubscribe failures and await disposal before delivery rechecks.
- Added durable EDA tasks with automatic candidate snapshots, typed task preparation/inspection, Pi dispatch restrictions, evidence-selected RAG/SOP guidance, fresh scope after compaction, and checked continuation with cumulative verifier budgets.
- Connected task scope, rounds, verdicts and recovery to the workbench. Final answers now use independently rechecked delivery; original model text remains in the local trace. Added classified offline task scenarios and stricter existing-session evaluation.

- Connected a host-owned verifier loop to the existing Pi session: fixed workflow acceptance, bounded RTL repairs, independent evidence readback, protected inputs and cumulative limits. The pinned NVIDIA ACE-RTL feedback components run through a bridge with their model transport disabled.
- Reconstruct task context from current evidence after compaction or branch restoration, and keep session completion separate from engineering acceptance. Offline checks use fake generation/EDA; no new model-quality or FPGA performance result is claimed.
- Organized dated reports under `docs/history/`, added source/local-data and Git publication guidance, and linked portable verifier receipts from the current documentation.

## 0.8.0 — 2026-10-25

- Added an RTL project inventory with module declarations, testbenches, constraints, source previews and evidence-bound engineering domains. File presence never implies a verified implementation.
- Added five test lanes with named software outcomes, retrieval queries, benchmark variants, engineering domains and real Agent receipts. Missing runs, expected failures and historical outcomes retain independent counts.
- Added file-and-line modification scopes, frozen inputs, reviewed previews and exclusive candidate creation. Tests, constraints and dependencies remain protected; candidate integrity and original drift are checked separately from engineering validation.
- Reused catalog, test-report and patch-review patterns from maintained open-source projects without importing their runtimes. Model APIs remain disabled.

## 0.7.0 — 2026-10-25

- Rebuilt the workbench around persistent conversations, task proposals, execution state and evidence inspection, following the local ERP workbench's session/workspace separation.
- Added session rename/archive/restore, scoped event cursors, durable jobs, owner-aware interruption handling, explicit cancellation and frozen plan checks before execution. Existing project workflow files can be planned from a conversation.
- Shared the native Pi session driver between CLI and workbench, with owned session continuation, public text streaming and cancellation. The disabled-model gate runs before SDK configuration or credential loading.
- Added offline counterexamples for crash recovery, cross-session task scope, model gating and stale-answer prevention. Model APIs remain disabled; fake SDK checks do not establish live model quality. See the workbench acceptance document and release receipts.

## 0.6.0 — 2026-10-25

- Added phase-scoped rule/SOP/tool context, CDC and IP integration procedures, and workflow observation refresh. There are now six bundled SOPs and 55 native interfaces.
- Added host-owned engineering outcome profiles, frozen identity/clock/checkpoint lineage, independent result readback and repeated-failure recovery limits.
- Added a loopback workbench for persistent local knowledge sessions, SOPs, execution timelines, domain outcomes and classified evaluations.
- Separated offline contracts/retrieval/evidence, live EDA workflows and existing Pi session-task assessment; receipts retain protocol hashes and stale-source markers.
- Validated real Counter simulation and structured DRC retrieval; preserved historical scorecards. Provider APIs remained disabled. See the release receipts for exact software and live EDA results.

## 0.5.0 — 2026-10-25

- Organized the README and historical results by EDA function, with source pointers for implemented mechanisms and their remaining limits.
- Replaced substring AND lookup with local English/Chinese BM25 retrieval, cited rules, filters and corpus hashes. The visible 24-question regression improves hit@5 from 3/24 to 24/24; this is not a blind model benchmark.
- Published all four existing SOP skills, exposed `eda_sop` through the native registry/MCP, and froze selected knowledge/SOP inputs in workflows.
- Added actual Pi resource-loader checks without opening a model session, missing-bundle and drift checks, and knowledge/session-recording coverage in offline CI.
- Preserved all 11 historical scorecards. No new FPGA performance, formal, board or model answer-quality result is claimed.

## 0.4.0 — 2026-10-25

- Compared pinned Pi, OpenHands SDK, mini-swe-agent, LangGraph and RouteAgents sources; recorded existing capabilities and remaining gaps.
- Added frozen workflow specifications, explicit per-step checks, structured outcome propagation, causal child traces and persisted task checkpoints.
- Added bounded continuation in a new run, validating code/input/result/output integrity and owner liveness before reusing completed steps.
- Added offline, counter and AXI workflow examples, fault-injection checks, contribution guidance and CI receipts on every run.
- Existing 11 historical scorecards remain unchanged. No new FPGA performance score or provider evaluation is claimed.

## 0.3.0 — 2026-10-25

- Published 48 native interfaces, community MCP integration, trace/recovery/OTLP support and historical scorecards.
- Added portable local setup, pinned dependencies and Windows offline CI; preserved exact evidence bytes across Git checkout.
