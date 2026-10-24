# REA requirement master list

This is the single source of truth for what this working tree was asked to add,
where each requirement landed, and which parts remain open. `repo.md` records the
upstream repositories and their licenses; this file records the requirements and
the logic that satisfies them.

Status meanings:

- **Done** — implemented and exercised by a test, a real provider session, or a
  generated artifact.
- **Partial** — a working slice exists; the remaining scope is named.
- **Deferred** — intentionally not built here; the reason and next step are given.
- **Not applicable** — the upstream project has no surface this repository can
  adopt.

## Master list

| ID   | Requirement                                                                            | Source                                                         | Status         | Implementation and proof                                                                                                                                                                                                                              |
| ---- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------- | -------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| R-01 | Keep Ghidra as the native analysis engine and decompiler.                              | Existing product                                               | Done           | `bridge/ghidra/ReaGhidraBridge.java`, `src/ghidra/`, `src/contracts/officialToolContracts.ts`. Bridge compiles against Ghidra 12.1.4; real headless sessions exercised inventory, decompilation and emulation.                                        |
| R-02 | Add every capability from `bethington/ghidra-mcp` natively, without its GUI extension. | User decision ("add all; native in REA's Java bridge")         | Partial        | Emulation and call-graph charting are native. Remaining scope is listed under [Open requirements](#open-requirements).                                                                                                                                |
| R-03 | Execute one function in Ghidra's P-code emulator with seeded state.                    | R-02                                                           | Done           | `emulate_native_function`; bridge `emulateNativeFunction`; `src/domain/native/nativeEmulation.ts`. Verified with a real headless run returning `42` in `EAX` plus a sentinel return address, and with fault/unseeded-memory cases.                    |
| R-04 | Search retained Evidence without transferring the complete bundle.                     | `mksglu/context-mode`, `ranxianglei/billion-context-pi`        | Done           | `search_evidence`, `src/domain/evidenceSearch.ts`, `src/application/investigation/SearchEvidence.ts`. BM25-style ranking, shared filters, 5,000-record / 64 Mi-character caps. Only the retrieval pattern is adopted; ELv2 code is not copied.        |
| R-05 | Record third-party repositories, licenses, roles and landing points.                   | User request                                                   | Done           | `repo.md`.                                                                                                                                                                                                                                            |
| R-06 | Add editorial, dependency-free chart rendering for analysis data.                      | `cathrynlavery/diagram-design` rules                           | Done           | `src/domain/charts/`: bar, line and call-graph renderers with the site palette, flat surfaces, accessible titles and deterministic output. 14 tests cover validation, escaping, layout, caps and HTML delivery.                                       |
| R-07 | Expose chart rendering as an MCP tool.                                                 | User request ("both surfaces")                                 | Done           | `render_native_chart`; contracts, effects, output schema, example and `src/server/registerChartTool.ts`. Exercised over MCP stdio: 224 tools listed, call returned titled SVG.                                                                        |
| R-08 | Chart the call graph Ghidra already produces, without extra provider calls.            | User request ("chart function in ghidra")                      | Done           | `get_call_graph` accepts `render: none \| svg \| html`; `src/application/native/CallGraphChart.ts` projects observed depth groups and caps large graphs with a limitation. Unit-tested, not yet exercised against a live Ghidra session.              |
| R-09 | Upgrade website figure making and enforce its design rules.                            | User request ("both surfaces")                                 | Done           | `npm run chart:figure` (`scripts/render-chart-figure.mjs`) renders committed SVG figures from JSON; `scripts/verify-website.py` rejects figures without a `viewBox`/`<title>` and any filter or shadow. Rule verified against a fixture site.         |
| R-10 | Render charts as videos through HyperFrames.                                           | `heygen-com/hyperframes` + user choice ("full pipeline now")   | Done           | `npm run chart:video` (`scripts/render-chart-video.mjs`) writes a checked composition, animates chart primitives with a paused GSAP timeline, and renders MP4. Check passed with zero findings; a 6.0s, 71 KB MP4 was rendered and a frame inspected. |
| R-11 | Keep agent-only skills out of runtime code.                                            | `mattpocock/skills`, `heygen-com/hyperframes-community-skills` | Done           | Documented in `repo.md`; installed per agent, not vendored.                                                                                                                                                                                           |
| R-12 | Do not force unrelated repositories into the product.                                  | `heygen-com/liveavatar-*`                                      | Not applicable | Both are avatar/sales applications with no chart, diagram or analysis surface. Documented as excluded in `repo.md`.                                                                                                                                   |
| R-13 | Make status and limitations auditable.                                                 | This list                                                      | Done           | Every status above names its exact proof or blocker; unverified items are never marked Done.                                                                                                                                                          |

## Integration logic

These are the rules used to decide placement and status. Apply them to every new
upstream feature.

1. **License gate first.** Anything copyleft-only or source-available without
   redistribution rights (for example Elastic License 2.0) is reimplemented as a
   pattern, never copied. MIT and Apache-2.0 code may be adapted with attribution.
2. **Duplication check.** If REA already provides the capability, extend it
   rather than adding a parallel path. Ghidra keeps its decompiler; emulation uses
   its P-code engine; call-graph charting reuses the existing traversal.
3. **Layer placement.** Engine → provider adapter → domain contract → application
   workflow → contracts/server interfaces. A chart is domain presentation; a
   provider graph is application projection; neither belongs in the bridge.
4. **Headless and ephemeral.** No GUI extension, persistent project or
   target-process execution is added when the same facts are available through
   the authenticated loopback bridge.
5. **Presentation is not evidence.** Charts and videos add no observations and
   record no Evidence. They may restate retained Evidence; they may not imply
   completeness that the observations do not have.
6. **Truncation is explicit.** Every cap (records, characters, nodes, edges)
   reports what was omitted. A capped chart is never presented as the complete
   graph.
7. **Verification before Done.** A requirement is Done only after a unit test, a
   real provider/bridge run, or a generated artifact was inspected. A successful
   typecheck or build alone is not proof.
8. **Agent instructions stay external.** Workflow skills are documented and
   installed by the user; they are not bundled into the analysis runtime.

## Chart request logic

```
chart request
  ├─ inline bar/line/call_graph spec ──► validate ──► render SVG/HTML ──► MCP result
  ├─ Ghidra call graph ──► get_call_graph(render)
  │                          ├─ traverse observed callers/callees
  │                          ├─ project depth groups to nodes/edges
  │                          ├─ cap at 128 nodes / 512 edges (+ limitation)
  │                          └─ render SVG/HTML
  └─ website figure ──► JSON spec ──► chart:figure ──► committed SVG
                                                        └─ website check validates
                                                           viewBox, title, no shadow

chart video
  └─ SVG ──► 1920×1080 HyperFrames composition (paused GSAP timeline)
        ──► hyperframes check ──► render MP4 (requires FFmpeg + ffprobe)
```

## Open requirements

| ID   | Remaining scope from R-02                          | Suggested landing point                                                                  |
| ---- | -------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| O-01 | Struct/union/enum authoring and field edits        | Bridge mutation handlers + `src/domain/native/` schemas + official tool contracts        |
| O-02 | Batch rename/comment/type operations with rollback | Bridge transaction handler; one bounded application workflow; one tool with effect audit |
| O-03 | Cross-binary documentation transfer                | Evidence-to-target import path; requires an explicit provenance and conflict policy      |
| O-04 | Debugger/TraceRmi control                          | Separate process adapter; must not run the target implicitly from an analysis tool       |
| O-05 | Ghidra script and server management                | Deferred: conflicts with the headless, single-Program, no-persistent-project design      |
| O-06 | Completeness scoring and calling-convention audits | Domain analysis of existing dossiers plus explicit unknown reporting                     |

Live verification still owed for O-01 through O-06 and for R-08 against a live
Ghidra session. No tool above should be marked Done until that proof exists.

## Verification commands and environment limits

```sh
npm run compile                     # build the chart CLI, video script and runtime
npx vitest run src/domain/charts src/application/native/CallGraphChart.test.ts
npm run verify:architecture-guards
npm run verify:module-boundaries
npm run verify:test-discovery
npx knip
npm run metadata:check
```

- `npm run check` cannot complete on this host because the Windows native
  controls are absent (`native/windows/build/manifest.json`). The individual
  checks above were run instead.
- The full website check needs CairoSVG; the new figure rule was verified against
  a fixture site instead.
- MP4 rendering requires system FFmpeg **and** ffprobe. `chart:video` fails with
  an actionable message when either is missing.
- HyperFrames loads GSAP from a CDN for the composition, so the first run needs
  network access.

Keep this file and `repo.md` in sync when a requirement, status or upstream
repository changes.
