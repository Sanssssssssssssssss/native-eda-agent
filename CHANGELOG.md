# Changelog

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
