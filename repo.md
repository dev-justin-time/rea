# Repositories used by REA

This file records every upstream repository this working tree draws on, what each
one contributes, where it lands in the codebase, and what was deliberately not
integrated. REA itself is `morluto/rea`. The requirement master list, statuses,
integration rules and remaining gaps are in [requirements.md](requirements.md).

## Integration order

Dependencies flow inward, matching [docs/architecture.mermaid](docs/architecture.mermaid):

1. **Engine** — Ghidra analyzes and decompiles the imported Program.
2. **Provider adapter** — `bridge/ghidra/` speaks one authenticated JSON protocol;
   `src/ghidra/` discovers, launches, validates and cleans up that engine.
3. **Domain contracts** — `src/domain/` owns result shapes and provenance rules.
4. **Application workflows** — `src/application/` composes provider facts without
   leaking engine protocols.
5. **Interfaces** — `src/contracts/` + `src/server/` expose CLI/MCP tools; generated
   catalogs and skills are outputs, never hand-edited.

Anything that only changes how an _agent_ behaves (workflow skills, context
compaction) is kept outside runtime code and documented below instead of being
embedded in the analysis pipeline.

## Upstream repositories

| Repository                                                                                            | License                                             | Role in this repo                                                                                                                                                                                                           | Landed in                                                                                                                  | Status                                  |
| ----------------------------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| [morluto/rea](https://github.com/morluto/rea)                                                         | MIT                                                 | Base product: CLI + MCP server for reverse engineering.                                                                                                                                                                     | Whole tree                                                                                                                 | Baseline (branch `main`)                |
| [NationalSecurityAgency/ghidra](https://github.com/NationalSecurityAgency/ghidra)                     | Apache-2.0                                          | Decompiler and analysis engine. REA imports one target into an ephemeral headless Ghidra database and talks to it over an authenticated socket. Bring-your-own installation, pinned to the verified release line.           | `bridge/ghidra/*.java`, `src/ghidra/`                                                                                      | Integrated (existing + extended)        |
| [bethington/ghidra-mcp](https://github.com/bethington/ghidra-mcp)                                     | Apache-2.0                                          | Feature reference for Ghidra-facing MCP capabilities. No code is vendored; REA implements the gaps natively in its own bridge instead of adopting the GUI extension/bridge pair.                                            | `bridge/ghidra/ReaGhidraBridge.java`, `src/domain/native/`, `src/contracts/officialToolContracts.ts`                       | Partially integrated (P-code emulation) |
| [mattpocock/skills](https://github.com/mattpocock/skills)                                             | MIT                                                 | Agent engineering workflows (grilling, TDD, bug diagnosis, architecture review, spec/ticket flow). These are agent instructions, not runtime features.                                                                      | Not vendored; install per-agent (`npx skills add mattpocock/skills`) alongside `.agents/skills/reverse-engineer-anything/` | Documented, not embedded                |
| [mksglu/context-mode](https://github.com/mksglu/context-mode)                                         | Elastic License 2.0 (source-available, **not** OSI) | MCP server that keeps raw tool output out of the model context, indexes session events in SQLite/FTS5, and retrieves only relevant slices. ELv2 forbids copying it into this MIT project, so only the _pattern_ is adopted. | `src/domain/evidenceSearch.ts`, `src/application/investigation/SearchEvidence.ts`, session tool `search_evidence`          | Pattern integrated                      |
| [ranxianglei/billion-context-pi](https://github.com/ranxianglei/billion-context-pi)                   | MIT                                                 | Pi-host extension for model-driven, multi-tier context compression plus `search_context` over compressed blocks. Pi-specific event interception has no equivalent in an MCP server, so only its retrieval model is used.    | `src/domain/evidenceSearch.ts` (bounded search over retained observations)                                                 | Pattern integrated                      |
| [cathrynlavery/diagram-design](https://github.com/cathrynlavery/diagram-design)                       | MIT                                                 | Editorial diagram rules: flat surfaces, no shadows or filters, restrained palette, real text, self-contained HTML/SVG. REA adopts the rules and its own renderer; no skill assets are vendored.                             | `src/domain/charts/`, `scripts/render-chart-figure.mjs`, `website/figures.md`                                              | Rules + tooling integrated              |
| [heygen-com/hyperframes](https://github.com/heygen-com/hyperframes)                                   | Apache-2.0                                          | HTML/CSS + seekable GSAP → deterministic MP4. Dev dependency (`0.8.190` in the lockfile) behind the opt-in chart-video export; rendering needs Chrome, FFmpeg and ffprobe.                                                  | `scripts/render-chart-video.mjs`, `package.json`                                                                           | Integrated (opt-in render)              |
| [heygen-com/hyperframes-community-skills](https://github.com/heygen-com/hyperframes-community-skills) | Apache-2.0                                          | Community HyperFrames workflows (explainers, captions, paint animation). Agent instructions for video production, not runtime chart code.                                                                                   | Not vendored; install per-agent with `npx skills add heygen-com/hyperframes-community-skills`                              | Documented, not embedded                |
| [heygen-com/liveavatar-gpt-live-demos](https://github.com/heygen-com/liveavatar-gpt-live-demos)       | MIT                                                 | Real-time LiveAvatar + GPT demos. Contains no chart, diagram or rendering code.                                                                                                                                             | Not applicable                                                                                                             | Not integrated                          |
| [heygen-com/liveavatar-sales-agent](https://github.com/heygen-com/liveavatar-sales-agent)             | MIT                                                 | Next.js talking-head sales agent with LiveAvatar, Anthropic and CRM integrations. No charting surface to upgrade.                                                                                                           | Not applicable                                                                                                             | Not integrated                          |

## What was integrated

### Ghidra decompiler (existing + verified)

REA already owns a native Ghidra provider:

- `bridge/ghidra/ReaGhidraBridge.java` — headless `HeadlessScript`; imports one
  target, exposes inventory, decompilation, P-code, xrefs, references, CFG, typed
  data and annotations over a token-authenticated socket.
- `src/ghidra/` — installation discovery, launch policy, transport, response
  validation, snapshot cache and provider capabilities.
- `src/contracts/officialToolContracts.ts` — public tools such as
  `analyze_function`, `procedure_pseudo_code`, `xrefs`, `inspect_native_data_type`.

The decompiler remains Ghidra's; REA never reimplements it or persists a Ghidra
project.

### P-code emulation (from ghidra-mcp's feature set, native implementation)

New capability: **`emulate_native_function`**.

- Bridge: `emulateNativeFunction` runs Ghidra's p-code emulator in an isolated
  state with caller-supplied register/memory seeds, a bounded step count, a
  synthetic stack/sentinel return for architectures with a stack pointer, and
  optional post-run memory reads.
- Domain: `src/domain/native/nativeEmulation.ts` defines the strict input and
  result contract, including fault/step-limit outcomes.
- Provider: `GHIDRA_FUNCTION_OPERATIONS` + capability limitations in
  `src/ghidra/GhidraFunctionValues.ts` and `GhidraProviderCapabilities.ts`.
- Interface: official MCP tool in `src/contracts/officialToolContracts.ts`,
  effects, output schema and example.
- Limits: no OS/API emulation, no automatic stack arguments, no target-process
  execution, no claim of native equivalence.

Verified by compiling the bridge against Ghidra 12.1.4 and driving a real headless
session against `build/fixtures/rea-ghidra-windows-x86.exe`: a function returning
`42` reported `outcome: returned`, `EAX: 0x2a`, and the sentinel return address;
unseeded external calls reported `fault` with the failing PC; seeded memory was
read back byte-for-byte.

### Retained-Evidence search (context-mode / billion-context model)

New session tool: **`search_evidence`**.

- `src/domain/evidenceSearch.ts` — deterministic BM25-style lexical ranking over
  retained Evidence payload text, with exact record filters, matched terms,
  snippets and explicit coverage limits (5,000 records / 64 Mi characters).
- `src/domain/evidenceRecordSummary.ts` — filter predicate is now shared by
  discovery (`get_evidence_bundle`) and search, so both select records identically.
- `src/application/investigation/SearchEvidence.ts` — application wrapper; search
  never starts or queries a provider.
- `src/contracts/sessionToolContracts.ts` + `src/server/registerSessionRecordTools.ts`
  — MCP registration and output contract.
- `src/domain/evidenceSearch.test.ts` — ranking, filters, limits, stop words and
  determinism.

This is the part of context-mode/billion-context that transfers to a server:
retrieval over already-retained observations instead of dumping everything into
the model context. Their agent-side features (hook injection, event indexing,
`compress`, Pi event interception) do not apply to an MCP analysis server and are
not copied.

### Charts and chart videos (diagram-design + HyperFrames)

Charts are one shared renderer, not three implementations:

- `src/domain/charts/` renders **bar**, **line** and **call_graph** figures with
  the website palette, 26/15/14/13px type scale, hairline rules and one blue
  accent. Output is self-contained SVG with `<title>`/`<desc>`, `role="img"`,
  escaped text, deterministic ids and no filters or shadows.
- `renderChart` returns the SVG, or a standalone HTML page, plus its exact
  canvas size. Inputs are validated: unique labels, one value per x label, real
  edge endpoints, bounded categories/series/nodes/edges.
- **`render_native_chart`** (MCP, read-only) exposes the same renderer for bar,
  line and explicit call-graph data. It adds no observations and records no
  Evidence.
- **`get_call_graph`** now accepts `render: none | svg | html`. The graph REA
  already traverses from Ghidra is projected straight into the layered chart,
  so charting costs no extra provider round trips. Graphs above 128 functions
  or 512 calls are capped with an explicit limitation, never a silently
  complete-looking chart.
- Website authors render committed figures with
  `npm run chart:figure -- spec.json --out public/assets/figures/name.svg`.
  `scripts/verify-website.py` now rejects published figures without a `viewBox`
  or non-empty `<title>`, and any that introduce a filter or shadow.
- `scripts/render-chart-video.mjs` wraps the same SVG in a 1920×1080
  HyperFrames composition, animates `.chart-bar`, `.chart-line`, `.chart-dot`
  or `.chart-node` with a paused GSAP timeline, runs `hyperframes check`, then
  renders MP4 when FFmpeg and ffprobe are available. The checked composition and a 6.0s MP4
  were produced locally; the frame was inspected.
- Guides: [charts, figures and videos](docs/charts-and-video.md) and
  [native function emulation](docs/native-emulation.md).

## Deliberately not integrated

- **context-mode code** — ELv2 is incompatible with redistributing this MIT
  project; only the retrieval pattern is reimplemented.
- **billion-context-pi plugin** — Pi-only in-process extension; REA has no Pi
  session API to hook.
- **ghidra-mcp's GUI extension/bridge** — conflicts with REA's headless,
  ephemeral-database, evidence-provenance model. Features are implemented
  natively instead.
- **mattpocock skills content** — kept as an optional agent install rather than
  product content, so REA's packaged skill surface stays focused and reviewable.
- **diagram-design skill bundle** — its HTML+SVG rules are adopted, but its 45
  templates and plugin manifests are not vendored; REA's renderer emits figures
  in the site's own system instead.
- **HyperFrames community skills** — video-production instructions, not runtime
  code. Agents can install them separately; the repository only pins the CLI.
- **LiveAvatar demos and sales agent** — real-time avatar applications with no
  chart, diagram or figure pipeline. Adding them would not upgrade chart making.

## Verification

- `npm run typecheck` — passes.
- `node scripts/verify-ghidra-bridge-sources.mjs` with `GHIDRA_INSTALL_DIR` — the
  complete bridge compiles against Ghidra 12.1.4 / Java 21.
- Real headless bridge session — inventory + emulation exercised over the
  authenticated loopback transport.
- `vitest run src/domain/charts src/application/native/CallGraphChart.test.ts` —
  16 tests pass (validation, escaping, layout, caps, HTML delivery).
- `npx tsc -p tsconfig.build.json` — the chart core and both scripts build and run.
- HyperFrames `check` on a generated call-graph composition — `ok: true`, zero
  lint and runtime findings; `render --quality draft` produced a 6.0s, 71 KB MP4.
- `npm run metadata:check`, `npm run verify:architecture-guards`,
  `npm run verify:module-boundaries`, `npm run verify:test-discovery` and
  `knip` — pass.
- After `npm run compile`, the MCP stdio server lists 224 tools including
  `render_native_chart`; calling it returned a titled SVG in `result.content`.
- `npm run check` cannot complete on this host because the Windows native
  controls are absent (`native/windows/build/manifest.json`); the individual
  checks above were run instead.
- The new website figure rule was exercised against a fixture site: a valid
  figure passed, a missing `<title>` failed, a filter failed, and a non-figure
  SVG was ignored. The full `python3 scripts/website.py check` was not run
  because the website Python environment cannot be installed here (CairoSVG is
  unavailable on this host).
- `vitest run src/contracts` — 181 tests pass, including the destructive-effect
  audit and the advertised-default composition case that previously failed.
- `vitest run src/server` still has 4 host-specific failures: two bundle
  asset-catalog checks and two Windows state-file locking checks. None touches
  the chart, CLI or contract paths changed here.
