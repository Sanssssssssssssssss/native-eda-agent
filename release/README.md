# Publication receipts

Start with the [project README](../README.md), [workflow guide](../docs/workflows.md) and [repository comparison](../docs/repository-comparison-2026-10-25.md).

`source-manifest.json` records the exact exported source bytes before local setup. `upstreams.json` and `python-requirements.lock` pin optional source dependencies and the tested Python environment. `local-evidence-links.json` lists local evidence omitted from the public package.

The published checkout adds `validation.json` and `validation-*.txt` from its own offline acceptance, with machine paths removed. `knowledge-evaluation.json` records the visible retrieval regression and exact query/corpus hashes. These checks are independent of the 11 historical FPGA/tool scorecards. GitHub Actions provides fresh logs for each commit.

Maintain the export allowlist in `scripts/build-public.mjs`; see [contribution guidance](../CONTRIBUTING.md). Do not copy runtime installations, credentials, conversations or large EDA artifacts into this directory.
