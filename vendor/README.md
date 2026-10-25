# Bundled and optional dependencies

Only these reviewed source snapshots belong in Git:

| Directory | Purpose | Source policy |
|---|---|---|
| `ace-rtl/` | Original NVIDIA feedback components used by the verifier loop | Full pinned upstream source, original licenses; no upstream model runner or dependencies are started |
| `vivado-mcp-community/` | Local community Vivado MCP backend | Reviewed source snapshot with the repository's adapter changes |
| `routeagents-fpl26/` | Physical strategy router and reference playbook | Selected source files with LICENSE and NOTICE |

Exact upstream commits are in [release/upstreams.json](../release/upstreams.json); the ACE inventory also records original normalized source hashes. [Third-party notices](../THIRD_PARTY_NOTICES.md) describe attribution and modifications. Snapshots contain no nested Git repository in a public checkout.

Optional benchmark RTL is fetched with `node scripts/fetch-example-upstreams.mjs`. Other research checkouts and installed tools remain local and ignored. Do not add a research clone as an accidental Git submodule.
