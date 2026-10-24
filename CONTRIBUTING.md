# Contributing

Use Node.js 24, Python 3.13 and the pinned Windows Python environment. Run `npm ci --ignore-scripts`, `pwsh scripts/bootstrap-python.ps1`, `npm run setup:local`, then `npm run validate:agent`. These checks do not start EDA or provider sessions.

For a new EDA operation, register one typed contract in the shared registry, use existing trace/resource execution, and define the actual evidence required for success. Explain why a new interface helps an agent select or verify an operation. Do not count an interface alias as a new engine or a test call as an independent design.

Workflow changes should cover relevant failure boundaries: a completed child with failed acceptance, changed inputs/outputs, a live owner, cumulative budgets, cancellation, or a torn checkpoint. Use fake EDA for software contracts. Real EDA validation must specify tool version, part, clocks, fixed checker and resulting artifacts separately.

For knowledge changes, keep each rule's source, supported version, applicability and required evidence explicit. Maintain `knowledge/sops.json` and the corresponding `.pi/skills/*/SKILL.md` together; referenced rule IDs must agree. Run `npm run knowledge:check` and `npm run knowledge:eval`. The checked-in questions are visible regression cases, not held-out evidence. Optional Ross sources may be absent in a public clone; the four bundled SOP files are required. Workflow guidance pins these files but does not convert prose into executable acceptance.

Include the relevant command, compact outcome and receipt link in a PR. Preserve failures and historical protocols. Never commit model credentials, raw conversation exports, proprietary installers, DCPs or waveforms. Large original artifacts remain local; public scorecards include source and sanitized-copy hashes.

Regenerate tool reference with `node scripts/tool-catalog.mjs --write` when contracts change. Keep README and the current workflow guide in sync, while retaining dated historical reports. `.gitattributes` preserves exact bytes because evidence hashes must survive checkout.

The development workspace and public checkout may be separate. `scripts/build-public.mjs EMPTY_DIRECTORY` exports an allowlisted snapshot from a full development workspace. It is a maintainer export command, not required by users of a public clone; preserve vendor licenses and review the exported diff before publishing.
