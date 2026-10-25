# Publication receipts

Start with the [project README](../README.md), [workflow guide](../docs/workflows.md) and [repository comparison](../docs/history/repository-comparison-2026-10-25.md).

`source-manifest.json` records the exact exported source bytes before local setup. `upstreams.json` and `python-requirements.lock` pin optional source dependencies and the tested Python environment. `local-evidence-links.json` lists local evidence omitted from the public package.

The published checkout adds `validation.json` and `validation-*.txt` from its own offline acceptance, with machine paths removed. `knowledge-evaluation.json` records the visible retrieval regression and exact query/corpus hashes. These checks are independent of the 11 historical FPGA/tool scorecards. GitHub Actions provides fresh logs for each commit.

For v0.6, `evaluation-v06.json` indexes local software, browser and real EDA receipts. `eda-v06/` contains sanitized Counter, AXI and DRC evidence with original and public-file hashes. The AXI workflow completed but requires DRC review; its six passing domains are not a full design pass. No provider session or new Agent end-to-end score is claimed. DCPs, waveforms, full conversations and runtime installations remain local.

For v0.7, see [workbench acceptance](../docs/workbench-v07-acceptance.md) for conversation/task interactions, browser screenshots and offline lifecycle checks. The new UI does not change the retained v0.6 engineering scores. Pi session continuation and streaming were tested with a fake SDK while provider calls remained disabled.

For v0.8, see [project workspace and scoped edits](../docs/workbench-v08.md). Project inventory, test classifications and line-scoped source candidates share the local workbench. Candidate creation verifies the selected changes and preserved inputs; it does not establish buildability or engineering acceptance. `evaluation-v08.json` records this release's software and browser validation; historical design scores retain their original protocols.

For the verifier loop upgrade, [`verifier-loop/validation.json`](verifier-loop/validation.json) records the offline acceptance and [`verifier-loop/demo.json`](verifier-loop/demo.json) records the two-round repair demonstration. The latter executes the pinned NVIDIA feedback components with fake generation and EDA; its failed → passed sequence is a software mechanism check. [`axi-plan.json`](verifier-loop/axi-plan.json) records static admission and [`backup.json`](verifier-loop/backup.json) summarizes the verified source backup. Historical FPGA scorecards keep their original protocols. See the [integration guide](../docs/ace-rtl-adaptation.md) and [dated upgrade receipt](../docs/history/verifier-loop-upgrade-2026-10-26.md). Complete source backup manifests remain in the development workspace.

Maintain the export allowlist in `scripts/build-public.mjs`; see [contribution guidance](../CONTRIBUTING.md). Do not copy runtime installations, credentials, conversations or large EDA artifacts into this directory.
