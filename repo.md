# Repositories used by REA

This file records every upstream repository this working tree draws on, what each
one contributes, where it lands in the codebase, and what was deliberately not
integrated. REA itself is `morluto/rea`.

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

| Repository                                                                          | License                                             | Role in this repo                                                                                                                                                                                                           | Landed in                                                                                                                  | Status                                  |
| ----------------------------------------------------------------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- | --------------------------------------- |
| [morluto/rea](https://github.com/morluto/rea)                                       | MIT                                                 | Base product: CLI + MCP server for reverse engineering.                                                                                                                                                                     | Whole tree                                                                                                                 | Baseline (branch `main`)                |
| [NationalSecurityAgency/ghidra](https://github.com/NationalSecurityAgency/ghidra)   | Apache-2.0                                          | Decompiler and analysis engine. REA imports one target into an ephemeral headless Ghidra database and talks to it over an authenticated socket. Bring-your-own installation, pinned to the verified release line.           | `bridge/ghidra/*.java`, `src/ghidra/`                                                                                      | Integrated (existing + extended)        |
| [bethington/ghidra-mcp](https://github.com/bethington/ghidra-mcp)                   | Apache-2.0                                          | Feature reference for Ghidra-facing MCP capabilities. No code is vendored; REA implements the gaps natively in its own bridge instead of adopting the GUI extension/bridge pair.                                            | `bridge/ghidra/ReaGhidraBridge.java`, `src/domain/native/`, `src/contracts/officialToolContracts.ts`                       | Partially integrated (P-code emulation) |
| [mattpocock/skills](https://github.com/mattpocock/skills)                           | MIT                                                 | Agent engineering workflows (grilling, TDD, bug diagnosis, architecture review, spec/ticket flow). These are agent instructions, not runtime features.                                                                      | Not vendored; install per-agent (`npx skills add mattpocock/skills`) alongside `.agents/skills/reverse-engineer-anything/` | Documented, not embedded                |
| [mksglu/context-mode](https://github.com/mksglu/context-mode)                       | Elastic License 2.0 (source-available, **not** OSI) | MCP server that keeps raw tool output out of the model context, indexes session events in SQLite/FTS5, and retrieves only relevant slices. ELv2 forbids copying it into this MIT project, so only the _pattern_ is adopted. | `src/domain/evidenceSearch.ts`, `src/application/investigation/SearchEvidence.ts`, session tool `search_evidence`          | Pattern integrated                      |
| [ranxianglei/billion-context-pi](https://github.com/ranxianglei/billion-context-pi) | MIT                                                 | Pi-host extension for model-driven, multi-tier context compression plus `search_context` over compressed blocks. Pi-specific event interception has no equivalent in an MCP server, so only its retrieval model is used.    | `src/domain/evidenceSearch.ts` (bounded search over retained observations)                                                 | Pattern integrated                      |

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

## Verification

- `npm run typecheck` — passes.
- `node scripts/verify-ghidra-bridge-sources.mjs` with `GHIDRA_INSTALL_DIR` — the
  complete bridge compiles against Ghidra 12.1.4 / Java 21.
- Real headless bridge session — inventory + emulation exercised over the
  authenticated loopback transport.
- `vitest` for the new domain and contract tests — passes; four unrelated baseline
  failures remain on this host (three `procedure_references` fixture assertions and
  one `toolEffects` destructive-list assertion), reproducible without these changes.
