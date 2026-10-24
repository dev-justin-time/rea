# New function roadmap for REA

Status: proposal only. Nothing in this document is implemented, scheduled, or
approved. It records what can be built from logic that already exists in this
checkout, what would have to be written for each function, and what the project
would need before any of it is worth merging.

The target reader is whoever picks up one of these items next: an agent or a
maintainer who needs the boundary, the contract, the Evidence rules, the reuse
map, and the verification lane before writing code.

## 1. Ground rules

These come from the repository's own guidance and are not negotiable for a new
public function:

- **Design around the analyst question** ([`docs/tool-design.md`](tool-design.md)).
  Extend an existing tool when intent and result contract already match. Add a
  tool only for a distinct outcome or materially different authority.
- **Prefer primitives, compose workflows.** A workflow is justified only when
  REA can join several retained sources without hiding a caller choice or an
  uncertainty.
- **Observed, derived, and inferred stay distinct.** A function may summarise
  retained facts; it must not upgrade them. Missing coverage is `unknown`, never
  absence.
- **No new Evidence from presentation.** A chart, report, or summary reads
  retained records; it does not manufacture observations. Tools that do query a
  provider must record the result through the existing Evidence path.
- **Evidence carries no wall-clock timestamp.** `src/domain/evidence.ts` records
  identity, subject, provider, analysis profile, predicate, parameters, result,
  confidence, authority, environment, limitations, relationship coverage,
  locations, and `evidence_links` — and no observation time. Any ordering a new
  function reports must be explicit (retention order, link direction, or a
  caller-supplied order), never "chronological" by implication.
- **Limits need a named ceiling and a recovery**
  ([`docs/design/limits-and-recovery.md`](design/limits-and-recovery.md)).
  Pagination, truncation, and partial failure are part of the contract.
- **Effects are declared exactly.** `src/contracts/toolEffects.ts` is audited by
  `src/contracts/toolEffects.test.ts`, including a wording check that flags
  descriptions containing run/launch/execute/start/install unless the effects or
  an explicit exception justify it.
- **CLI/MCP parity is accounted for.** Every public tool needs a CLI command, a
  `CLI_COMMAND_TOOL_ALIASES` entry, or an entry in
  `MCP_TOOLS_WITHOUT_DEDICATED_CLI` with a reason
  (`tests/boundary/cli/cliToolCoverage.test.ts`).

## 2. Current surface

The build-generated catalog (`docs/public/product-catalog.json`, produced by
`scripts/generate-product-catalog.mjs`) currently reports **224 public MCP
tools**:

| Family                                              | Count | Examples                                                                       |
| --------------------------------------------------- | ----- | ------------------------------------------------------------------------------ |
| direct (provider proxy)                             | 42    | `procedure_pseudo_code`, `xrefs`, `search_strings`                             |
| enhanced                                            | 15    | `analyze_function`, `get_call_graph`, `trace_call_path`                        |
| native                                              | 27    | `inspect_macho`, `inspect_pe_resources`, `observe_native_calls`                |
| artifact                                            | 23    | `inspect_artifact`, `inspect_asset_catalog`, `inspect_sqlite_database`         |
| managed                                             | 7     | `inspect_managed_members`, `verify_managed_native_boundaries`                  |
| firmware / android / pcap / flutter / apktool / jeb | 17    | format-specific inspectors                                                     |
| adb                                                 | 24    | device, package, logcat, and file operations                                   |
| browser / electron / javascript-runtime             | 20    | `capture_browser_scenario`, `observe_web_execution`                            |
| frida                                               | 9     | session and script lifecycle                                                   |
| application                                         | 15    | `evaluate_reconstruction_coverage`, `project_*_application_graph`              |
| session                                             | 25    | `open_binary`, `get_evidence_bundle`, `search_evidence`, `render_native_chart` |

The CLI additionally exposes `doctor`, `capabilities`, `providers`, and
`inspect-evidence-bundle`. Those diagnostic commands have **no MCP
counterpart**, which matters for agents that never leave the MCP session.

Related existing tools a new function must not duplicate: `get_evidence_bundle`,
`search_evidence`, `inspect_analysis_view`, `list_unknowns`, `verify_reconstruction`,
`evaluate_reconstruction_coverage`, `find_changed_behavior`, `compare_artifacts`,
`compare_bundles`, `compare_functions`, `render_native_chart`.

## 3. Reusable building blocks

| Concern                                | Module                                                                                          | What it already gives us                                                          |
| -------------------------------------- | ----------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------- |
| Evidence record and identity           | `src/domain/evidence.ts`, `src/domain/evidenceBundle.ts`                                        | strict schema, `evidence_id` authentication, bundle merge and duplicate rejection |
| Evidence references and summaries      | `src/domain/evidenceReference.ts`, `src/domain/evidenceRecordSummary.ts`                        | compact references, filters, per-operation summaries                              |
| Lexical search                         | `src/domain/evidenceSearch.ts`                                                                  | bounded BM25-style ranking over payload text                                      |
| Relationship coverage                  | `src/domain/relationshipCoverage.ts`, `src/domain/functionCallCoverage.ts`                      | complete/unknown caller and callee coverage                                       |
| Unknowns and claims                    | `src/domain/reconstructionUnknowns.ts`                                                          | heads, claims, probes                                                             |
| Obligation ledger                      | `src/domain/evidenceCompletionLedger.ts`, `src/domain/reconstructionObligationLedgerSchemas.ts` | completion records, integrity checks                                              |
| Comparison semantics                   | `src/domain/comparisonSemantics.ts`, `comparisonStatus.ts`, `comparisonEvidenceResult.ts`       | `absenceClaimable`, status vocabulary, evidence parsing                           |
| Function comparison                    | `src/domain/functionComparison.ts`, `functionDossierEvidence.ts`                                | member/instruction comparison and Evidence snapshots                              |
| Coverage evaluation                    | `src/application/ReconstructionCoverageService.ts`, `src/domain/reconstructionCoverage*.ts`     | verifier contract, closure results                                                |
| Provider health                        | `src/domain/providerOperationHealth.ts`, `src/application/CapabilityInventory.ts`               | operation states, retry actions, capability inventory                             |
| Provider registry and profiles         | `src/application/binary/AnalysisProviderRegistry.ts`, `src/domain/analysisProfile.ts`           | provider selection, RFC 8785 profile commitments                                  |
| Windows authority                      | `src/windows/WindowsNativeLoader.ts`, `src/process/WindowsAuthority.ts`                         | cached artifact admission and typed failure reasons                               |
| Environment diagnosis                  | `src/cli/environmentCommands.ts`                                                                | `doctor`/`capabilities` checks and remediation text                               |
| Charts                                 | `src/domain/charts/chartSpec.ts`, `renderChart.ts`, `svgFrame.ts`                               | bar, line, call-graph charts with hard caps                                       |
| File snapshots and artifact comparison | `src/domain/fileSnapshotObservation.ts`, `artifactComparison.ts`                                | digest-bound snapshots, explicit comparison status                                |
| Changed behavior                       | `src/domain/changedBehavior.ts`                                                                 | runtime changes separated from static candidates                                  |
| Output safety                          | `src/artifacts/SafeOutputTree.ts`                                                               | readback and fsync before publishing a file                                       |
| Result delivery                        | `src/server/ToolResultDelivery.ts`, `src/server/toolResultEncoding.ts`                          | budgets, structured-plus-text, overflow recovery                                  |

Two modules are **not** candidates for exposure:

- `src/domain/reconstructionReadiness.ts` — the conformance evaluator. The
  project's own guide says it "is not exposed as a public CLI command or MCP
  tool" (`docs/reconstruction-readiness.md`). Keep it internal.
- `src/domain/conformanceReplay.ts` — CI replay/trust gate. Exposing it would
  turn a build assertion into a caller-facing claim.

## 4. Proposed functions

Each proposal lists: boundary and shape, question answered, input, result,
Evidence semantics, reuse, new logic, limits, effects and placement,
verification, and effort. Effort assumes the existing conventions in this repo:
S ≈ under a day, M ≈ one to three days, L ≈ more.

### F1. `explain_evidence_chain` — trace one observation's provenance

| Field     | Value                                                                                                                                                                                                               |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape     | `trace`                                                                                                                                                                                                             |
| Boundary  | Read-only session tool. Nearest alternatives: `get_evidence_bundle` (whole bundle) and `inspect_analysis_view` (rendered retained view). Those return records or views, not the provenance path of one observation. |
| Question  | "Why does REA know this, and which earlier observations does it rest on?"                                                                                                                                           |
| Effects   | none (read-only, idempotent)                                                                                                                                                                                        |
| Placement | MCP session tool; CLI `explain-evidence-chain --bundle <file> --evidence <ev_…>` reads an exported bundle                                                                                                           |

Input (strict):

```ts
const evidenceChainInputSchema = z.strictObject({
  evidence_id: z.string().regex(/^ev_[0-9a-f]{64}$/u),
  direction: z.enum(["ancestors", "descendants", "both"]).default("ancestors"),
  max_depth: z.int().min(1).max(8).default(3),
  max_records: z.int().min(1).max(200).default(50),
});
```

Result sketch:

```ts
{
  chain_id: string,                 // digest over the returned subgraph
  root: evidenceReference,          // id, operation, subject, confidence, authority
  nodes: Array<{
    evidence_id: string,
    operation: string,
    predicate_type: string,
    confidence: "observed" | "derived" | "inferred",
    authority: string,
    depth: number,
    subject_digest: string | null,
    locations: EvidenceLocation[],
    limitations: string[],
  }>,
  edges: Array<{ from: string, to: string }>,
  missing_links: string[],          // referenced ids absent from the bundle
  truncated: boolean,
  omitted: { records: number, links: number },
  recovery: string | null,
}
```

Evidence semantics: pure projection of the authenticated bundle. It records no
Evidence, changes no state, and does not rank importance. A link to a record that
is not in the bundle is reported in `missing_links`, never dropped; that is an
observation about the bundle, not about the target.

Reuse: `authenticateParsedEvidenceBundle`, `evidenceReferenceSchema`,
`canonicalOrdering.uniqueSorted`, `evidenceRecordSummary` for the root line.

New logic: cycle-safe traversal over `evidence_links` with deterministic
ordering (BFS by `evidence_id` at each depth), depth and record caps, and budget
accounting through `ToolResultDelivery`. The bundle is already a DAG by
construction, but the traversal must still defend against malformed imports.

Limits and recovery: the two caps above; when hit, `truncated` is true,
`omitted` counts what was not expanded, and `recovery` names the narrower query
(reduce `max_depth`, or query a specific node). No silent partial success.

Verification: unit tests for a linear chain, a diamond, a cycle, a dangling
link, and cap behaviour; a contract test that the result validates against the
advertised output schema; one conformance bundle fixture
(`tests/conformance/...` already ships evidence fixtures) proving determinism
across two runs.

Effort: **S**. No provider and no new Evidence path.

### F2. `compare_evidence_bundles` — compare retained Evidence with a supplied bundle

| Field     | Value                                                                                                                                                                                                                    |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shape     | `compare`                                                                                                                                                                                                                |
| Boundary  | Read-only session tool plus CLI. Nearest alternative: `import_evidence_bundle` merges another bundle into the session (a mutation) and `search_evidence` finds text; neither reports correspondence between two bundles. |
| Question  | "What did this second run observe that my current session did not, and can I claim that difference?"                                                                                                                     |
| Effects   | reads one local file; no session mutation, no provider                                                                                                                                                                   |
| Placement | MCP session tool; CLI `compare-evidence-bundles <left.json> <right.json>`                                                                                                                                                |

Input (strict):

```ts
const compareEvidenceBundlesInputSchema = z.strictObject({
  path: z.string().min(1), // caller-supplied bundle file
  basis: z.enum(["current", "path"]).default("current"),
  max_groups: z.int().min(1).max(64).default(32),
});
```

Result sketch:

```ts
{
  status: "compatible" | "partial" | "incompatible",
  basis: { left: EvidenceBundleIdentity, right: EvidenceBundleIdentity },
  compatibility: {
    target: "same" | "different" | "unknown",
    analysis_profile: "same" | "different" | "unknown",
    provider: "same" | "different" | "unknown",
    reasons: string[],
  },
  groups: Array<{
    operation: string,
    matched: number,
    current_only: number,
    reference_only: number,
    absent_claimable: boolean,      // from comparisonSemantics.absenceClaimable
    unknown: number,                // correspondence not provable
  }>,
  examples: Array<{ kind: string, evidence_id: string, operation: string }>,
  limitations: string[],
  truncated: boolean,
}
```

Evidence semantics: this is the boundary table from `docs/tool-design.md`
applied to bundles. A record present only in the reference is reported as an
observed difference **only** when the current side's coverage for that operation
is known complete; otherwise it is `unknown`. A target or analysis-profile
mismatch makes the comparison `incompatible` and blocks per-record claims. The
tool records no Evidence and never merges the two bundles.

Reuse: `readImmutableEvidenceBundle` (the same loader
`import_evidence_bundle` uses), `authenticateParsedEvidenceBundle`,
`comparisonSemantics.absenceClaimable`, `comparisonStatusSchema`,
`canonicalDigest`, `evidenceRecordSummary`.

New logic: a correspondence projection. Pairing must be semantic, not by
`evidence_id` alone: operation, subject digest, parameters, provider identity,
and analysis-profile digest. Records that cannot be paired are `unknown`, not
`reference_only`. Deltas are grouped per operation with counts and a bounded
sample.

Limits and recovery: group cap and sample cap; report totals even when samples
are omitted. If either side fails authentication, fail closed with the existing
`EvidenceIntegrityError` projection.

Verification: fixtures for identical bundles, one added record, one record with
a changed parameter, mismatched profile, tampered bundle, and an incomplete
coverage side (must produce `unknown`, not a difference). Contract tests for
`incompatible` short-circuiting. CLI test that a bad path produces a typed
failure, not a stack trace.

Effort: **M**. The comparison semantics exist; the correspondence projection and
the fail-closed matrix are new.

### F3. `audit_evidence_coverage` — what this session can and cannot support

| Field     | Value                                                                                                                                                                                                                                                                                            |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shape     | `workflow` (read-only)                                                                                                                                                                                                                                                                           |
| Boundary  | Session audit over retained Evidence. Nearest alternatives: `get_evidence_bundle` (raw records), `evaluate_reconstruction_coverage` (a verifier contract against supplied source), `verify_reconstruction` (closure). None answers "which observations are missing before I can claim anything?" |
| Question  | "Where are my gaps, and what is the next observation that would close each one?"                                                                                                                                                                                                                 |
| Effects   | none                                                                                                                                                                                                                                                                                             |
| Placement | MCP session tool; CLI `audit-evidence-coverage --bundle <file>`                                                                                                                                                                                                                                  |

Input (strict):

```ts
const auditEvidenceCoverageInputSchema = z.strictObject({
  focus: z
    .enum(["all", "native", "runtime", "comparison", "unknowns"])
    .default("all"),
  include_remediation: z.boolean().default(true),
});
```

Result sketch:

```ts
{
  audit_id: string,
  totals: { records: number, observed: number, derived: number, inferred: number },
  operations: Array<{
    operation: string,
    records: number,
    relationship_coverage: "complete" | "unknown" | null,
    truncated_records: number,
    contradictions: number,
  }>,
  gaps: Array<{
    gap_id: string,
    kind: "missing-observation" | "incomplete-coverage" | "unresolved-unknown" | "contradiction",
    affects: string[],             // operations or unknown ids
    evidence_ids: string[],
    closing_observation: string | null,
  }>,
  unknowns: { open: number, resolved: number, probes_without_evidence: number },
  limitations: string[],
}
```

Evidence semantics: every gap cites the records that establish it. An operation
with no records produces a single `missing-observation` gap and no invented
detail. A `derived` or `inferred` record never counts as an observation for gap
closure. Exhaustive-sounding language is banned by the contract: coverage is
reported per operation, not globally.

Reuse: `investigationEvidenceBundle(session)`, `summarizeEvidenceBundle`,
`relationshipCoverageSchema`, `reconstructionUnknowns`, `evidenceCompletionLedger`
(completion states), and `analysisView` coverage fields where a view exists.

New logic: an operation taxonomy shared with the documentation (so a new tool
must declare its operation when it is added), gap derivation, and deterministic
`gap_id` digests over `kind + affects + evidence_ids`.

Limits and recovery: no pagination needed if the result is summarised per
operation; cap the number of distinct gaps at 128 and report the omitted count.
The recovery is to narrow `focus`.

Verification: unit tests for an empty session, a complete native-only session, a
session with a truncated relationship read, a session with an unresolved
unknown, and a session with a contradiction. A determinism test (two runs, same
digest). A docs test that the operation taxonomy lists every registered tool's
Evidence operation — that is the real protection against drift.

Effort: **M**. The data all exists; the taxonomy and gap rules are new.

### F4. `diagnose_environment` — MCP mirror of `rea doctor` / `rea capabilities`

| Field     | Value                                                                                                                                                        |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Shape     | `inspect`                                                                                                                                                    |
| Boundary  | Read-only environment inspection. Nearest alternative: `binary_session` reports tool availability for the open session; `rea doctor` exists only on the CLI. |
| Question  | "Why can this agent not run the intended operation, and what exactly is missing?"                                                                            |
| Effects   | reads local configuration and probes installed tools; no network by default, no install, no mutation                                                         |
| Placement | MCP tool with `CLI_COMMAND_TOOL_ALIASES.doctor = ["diagnose_environment"]` and a matching `capabilities` alias                                               |

Input (strict):

```ts
const diagnoseEnvironmentInputSchema = z.strictObject({
  provider: z
    .enum(["ghidra", "hopper", "ida", "kuna", "jeb", "rizin", "gdb"])
    .optional(),
  formats: z
    .array(
      z.enum(["macho", "pe", "elf", "apk", "wasm", "plist", "managed", "pcap"]),
    )
    .max(16)
    .default([]),
});
```

Result sketch:

```ts
{
  checks: Array<{
    id: string,                    // "ghidra.install", "java.version", "windows.native-controls"
    status: "available" | "missing" | "unsupported" | "unknown",
    detail: string | null,
    remediation: string | null,
    evidence: JsonValue | null,    // versions, paths, refusal reason; no secrets
  }>,
  tools: Array<{ name: string, available: boolean, reason: string | null }>,
  windows_native_authority: { available: boolean, reason: string | null },
  summary: { available: number, missing: number, unknown: number },
}
```

Evidence semantics: this tool observes the host and configuration, not the
target. It records no Evidence (the environment is reproducible; the artifact is
not), and it must never include token values, bridge descriptors, or client
configuration secrets. It must not install, update, or repair anything — the
project's setup rules forbid silent mutations.

Reuse: `src/cli/environmentCommands.ts` (extract the checks behind `doctor` and
`capabilities` into a reusable function rather than shelling out),
`CapabilityInventory`, `providerOperationHealth` vocabulary,
`systemWindowsNativeAuthority()`, `providerConfigurationRefusal` remediation.

New logic: a stable check identifier per condition, status normalisation
(`unsupported` vs `missing` vs `unknown`), and MCP-safe projection that omits
paths only when they would disclose a secret.

Limits and recovery: bounded number of checks; each check has its own timeout
(from `doctor`) and reports `unknown` rather than hanging the whole call.

Verification: tests for a fully configured host, a missing Ghidra, an
unavailable Windows native artifact, and an unknown provider. A secrecy test
asserting the result contains no environment values from a fixture that sets
sentinel tokens. CLI parity test through the alias.

Effort: **M**. Mostly refactoring existing checks behind a shared function plus a
contract.

### F5. `project_unknown_impact` — connect unknowns to the evidence and paths they affect

| Field     | Value                                                                                                                                                                                                                     |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape     | `trace`                                                                                                                                                                                                                   |
| Boundary  | Read-only trace across unknowns, their claims, Evidence links, and observed call paths. Nearest alternatives: `list_unknowns` (records), `trace_call_path` (one path), `build_reconstruction_obligation_ledger` (ledger). |
| Question  | "Which unresolved unknowns actually matter for this procedure or obligation, and what do they block?"                                                                                                                     |
| Effects   | none                                                                                                                                                                                                                      |
| Placement | MCP session tool; CLI `project-unknown-impact --bundle <file> --unknown <id>`                                                                                                                                             |

Input (strict):

```ts
const unknownImpactInputSchema = z.strictObject({
  unknown_ids: z.array(z.string().min(1)).max(32).default([]),
  procedure: z.string().optional(),
  direction: z.enum(["forward", "backward"]).default("forward"),
  max_depth: z.int().min(1).max(16).default(6),
  max_nodes: z.int().min(1).max(512).default(128),
});
```

Result sketch:

```ts
{
  projection_id: string,
  unknowns: Array<{
    unknown_id: string,
    revision: number,
    status: string,
    claims: string[],
    probes: number,
    affects: Array<{ kind: "procedure" | "obligation" | "evidence", id: string, proven: boolean }>,
  }>,
  procedures: Array<{ procedure: string, unknown_ids: string[], depth: number }>,
  no_observed_dependency: string[],   // unknowns with no retained path
  truncated: boolean,
  limitations: string[],
}
```

Evidence semantics: "affects" means a retained path or claim references the
unknown; the result must not claim runtime impact. A missing observation is
reported in `no_observed_dependency`, which is not a claim that the unknown is
irrelevant. Incomplete call coverage is surfaced as a limitation and prevents
`proven: true` for affected procedures.

Reuse: `reconstructionUnknowns` (heads, claims, probes), `callPath` and
`CallPathTracing`, `functionCallCoverage`/`relationshipCoverage`,
`evidenceBundle` links, `reconstructionObligationLedgerSchemas`.

New logic: a join between unknowns and paths that records the proof for each
edge (direct claim, call-path membership, or obligation reference) and keeps
unproven links separate.

Limits and recovery: depth/node caps; truncation reported; recovery is a
narrower starting procedure or fewer unknowns.

Verification: fixtures for an unknown claimed by one procedure, an unknown only
referenced by an obligation, an unknown with no path, and an unknown behind a
truncated caller read (must be `proven: false`). Determinism and budget tests.

Effort: **M**. Reuses path and unknown logic; the join proof is new.

### F6. `render_session_chart` — presentation of session aggregates

| Field     | Value                                                                                                                                                                  |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape     | `workflow` (presentation only)                                                                                                                                         |
| Boundary  | Read-only chart generation over retained aggregates. Nearest alternative: `render_native_chart` accepts a caller-supplied chart spec; it does not derive session data. |
| Question  | "Show me the shape of this investigation — where the evidence is, where the gaps and unknowns are."                                                                    |
| Effects   | none                                                                                                                                                                   |
| Placement | MCP session tool; CLI `render-session-chart --bundle <file>`; reuses `scripts/lib/chart-renderer.mjs` for offline rendering                                            |

Input (strict):

```ts
const sessionChartInputSchema = z.strictObject({
  source: z.enum([
    "evidence_operations",
    "unknowns",
    "coverage",
    "evidence_confidence",
  ]),
  format: z.enum(["svg", "html"]).default("svg"),
  top: z.int().min(1).max(32).default(16),
  title: z.string().max(120).optional(),
});
```

Result sketch:

```ts
{
  chart: RenderedChart,                       // same schema as render_native_chart
  data: { source: string, categories: number, omitted: number, unit: string },
  evidence_ids: string[],                     // records the aggregate was computed from
  limitations: string[],
}
```

Evidence semantics: the chart is presentation. The result includes the
aggregate table and the contributing `evidence_ids` so the numbers are auditable,
but the tool records no Evidence and adds no observations. It must not render
"confidence" as if it were truth; `evidence_confidence` is a count by record
confidence, labelled as such.

Reuse: `src/domain/charts/*` (bar and line only — do not add decorative kinds),
`chartSpec` caps (64 categories, 4 series), `evidenceRecordSummary`,
`reconstructionUnknowns`, the F3 audit output.

New logic: aggregate adapters and deterministic category ordering (count
descending, then label) with omitted counts when `top` truncates.

Limits: the existing chart caps apply; the aggregate is capped before rendering
and reports omission in both `data.omitted` and `limitations`.

Verification: SVG snapshot/identity tests (the repo already asserts SVG
identity), accessibility checks (`role="img"`, non-empty `<title>`), and a test
that the same bundle produces byte-identical output.

Effort: **S** once F3 exists; **M** standalone.

### F7. `export_investigation_report` — a citable dossier

| Field     | Value                                                                                                                                                                                                             |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape     | `workflow` + file write on the CLI                                                                                                                                                                                |
| Boundary  | Presentation over retained Evidence. Nearest alternative: `export_evidence_bundle` (machine-readable bundle) and `inspect_analysis_view` (one view). Neither produces a human-readable, citation-complete report. |
| Question  | "Give me a report I can hand to a reviewer, with every claim linked to Evidence."                                                                                                                                 |
| Effects   | CLI writes one file; MCP returns text only                                                                                                                                                                        |
| Placement | MCP session tool returns Markdown; CLI `report` writes through `SafeOutputTree`                                                                                                                                   |

Input (strict):

```ts
const investigationReportInputSchema = z.strictObject({
  format: z.enum(["markdown", "html"]).default("markdown"),
  include_charts: z.boolean().default(false),
  max_records: z.int().min(1).max(2000).default(500),
});
```

Result sketch:

```ts
{
  report_id: string,                    // digest over the rendered body + cited ids
  format: "markdown" | "html",
  body: string,
  cited_evidence_ids: string[],
  sections: string[],
  omissions: { records: number, charts: number },
  limitations: string[],
}
```

Report sections: scope and target identity (digest, format, architecture),
method and provider/profile commitments, evidence inventory by operation,
observed facts, derived findings, contradictions, unresolved unknowns,
coverage gaps with next observations, and a citation list. Every factual line
ends with an `ev_…` reference. No timestamps, no "recently", no implied
chronology.

Evidence semantics: no new Evidence; the report is a projection. It must be
deterministic: identical bundle and inputs produce an identical body and
`report_id`. Charts are embedded SVG from the same renderer, or omitted with a
count.

Reuse: `summarizeEvidenceBundle`, `reconstructionUnknowns`, F3 audit, F6 chart
data, `canonicalDigest`, `SafeOutputTree` (CLI), `ToolResultDelivery` (MCP text
budget with overflow recovery).

New logic: the template, section assembly, citation rendering, and the digest
over rendered content. A Markdown renderer is not needed; emit Markdown directly
and escape caller-influenced text.

Limits and recovery: `max_records` bounds the citation list; the body is bounded
by the MCP text budget, with the CLI path as the recovery for a large report
("write it with `rea report` instead"). Truncation is stated in the report
itself, not only in the envelope.

Verification: golden report for a fixture bundle, digest stability across runs,
citation completeness (every `ev_` in the body exists in the bundle), escaping
tests for hostile target-supplied strings, and a CLI test that an existing file
is replaced atomically with readback.

Effort: **M**.

### F8. `rea compare-providers` — one query, two providers, explicit agreement

| Field     | Value                                                                                                                                                         |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape     | `compare` (CLI-first)                                                                                                                                         |
| Boundary  | Explicitly paired provider observations. Nearest alternative: `compare_functions` compares two retained function observations; it does not run the providers. |
| Question  | "Do Ghidra and IDA agree about this procedure, and where exactly do they diverge?"                                                                            |
| Effects   | launches operator-configured analysis engines; opens and closes two sessions; writes no files                                                                 |
| Placement | CLI only at first; an MCP tool would need a cost/admission policy before it is safe to expose                                                                 |

Input (CLI):

```
rea compare-providers --target /abs/target --procedure main \
  --providers ghidra,ida [--json]
```

Result sketch:

```ts
{
  status: "compatible" | "partial" | "incompatible",
  target: { name: string, sha256: string, format: string, architecture: string | null },
  sides: Array<{
    provider: ProviderIdentity,
    analysis_profile: string,        // digest
    operation: "procedure_pseudo_code" | "procedure_assembly",
    coverage: "complete" | "unknown",
    unavailable_reason: string | null,
  }>,
  comparison: {
    comparable: boolean,
    reasons: string[],
    agreed: string[],
    divergent: Array<{ subject: string, left: string, right: string }>,
    unknown: string[],
  },
  cleanup: { sessions_closed: boolean, reason: string | null },
}
```

Evidence semantics: both observations are recorded as Evidence by the existing
provider paths and the comparison cites them; the result must not label a
divergence a defect. Different analysis profiles (versions, loaders, options)
make the comparison `partial` with reasons, not a false equivalence. Each
provider's coverage is reported separately.

Reuse: `AnalysisProviderRegistry`, `analysisProfile` commitments,
`functionComparison`/`functionComparisonDimensions`, `functionDossierEvidence`,
`comparisonSemantics`, the existing session lifecycle and cleanup paths.

New logic: bounded dual sessions (sequential, not concurrent, on a small
machine), profile comparison, and a short-circuit when one side is unavailable.

Limits and recovery: one target, one procedure, two providers, one operation per
run; each session has the standard startup timeout; if the second provider fails,
report the first observation and the failure rather than discarding both.

Verification: a real-provider lane (Ghidra plus a second engine) per
`docs/testing.md`; unit tests with fake providers for the compatibility matrix;
cleanup tests for startup failure and cancellation; a test that a version skew
yields `partial` rather than `agreement`.

Effort: **L**. The provider work is the cost; the comparison logic exists.

### F9. `rea watch` — re-analyse a changed artifact and report changed behaviour

| Field     | Value                                                                                                                                                                                 |
| --------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Shape     | `observe` (CLI only)                                                                                                                                                                  |
| Boundary  | A local file watch that produces successive analyses. Nearest alternative: `compare_artifacts` (one explicit pair) and `find_changed_behavior` (aggregate over existing comparisons). |
| Question  | "Tell me when this binary changes and what behaviour changed."                                                                                                                        |
| Effects   | launches analysis, writes Evidence per pass, reads the filesystem repeatedly                                                                                                          |
| Placement | CLI only; MCP sessions are request-scoped and should not own a long-running watcher                                                                                                   |

Input (CLI):

```
rea watch /abs/target --provider ghidra --procedure main \
  --interval 2 --passes 5 [--json-lines]
```

Result (one record per pass):

```ts
{
  pass: number,
  snapshot: { path: string, sha256: string, size: number, changed: boolean },
  analysis: { opened: boolean, provider: ProviderIdentity | null, reason: string | null },
  changed_behavior: ChangedBehaviorResult | null,
  cleanup: { session_closed: boolean, reason: string | null },
}
```

Evidence semantics: each pass records its own observations; a changed digest is
a fact about the file, not a claim that behaviour changed. `changed_behavior` is
only produced when both passes have comparable observations; otherwise the pass
reports `reason`. Watcher termination is not a completeness claim.

Reuse: `fileSnapshotObservation`, `compare_artifacts`, `changedBehavior`,
`AnalysisProviderRegistry`, session lifecycle, `AnalysisCancelledError`, CLI
JSON-lines output.

New logic: a polling loop with digest comparison, debounce, bounded passes,
signal handling, and per-pass cleanup ordering. No new comparison semantics.

Limits: `passes` and `interval` are explicit; the default is bounded. A file that
keeps changing yields passes that report `changed: true` and no comparison until
two stable snapshots exist.

Verification: a test harness that replaces a fixture file between passes; a
cancellation test (SIGINT) proving the session is closed; a test that an
unreadable file yields a typed failure and the watcher continues; no real
provider required for the loop tests.

Effort: **L**. Loop, cancellation, and lifecycle testing dominate.

## 5. Considered and deferred

| Idea                                          | Why not now                                                                                                                                                                                                      |
| --------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Expose the reconstruction-readiness evaluator | The project explicitly keeps it internal (`docs/reconstruction-readiness.md`); exposing it would blur project conformance with a caller's investigation. F3 covers the live-session question without that claim. |
| Public conformance replay                     | `src/domain/conformanceReplay.ts` is a CI trust gate. A public tool would let callers mistake a replay for a target observation.                                                                                 |
| Semantic/embedding search over Evidence       | No embedding dependency exists, and the lexical contract (`search_evidence`) is deliberate. A local model would add a large runtime and a truth claim the project avoids.                                        |
| Automatic "fix" of missing environment pieces | Setup rules forbid silent installs; F4 reports remediation only.                                                                                                                                                 |
| Multi-target batch analysis tool              | The CLI already composes per-file commands, and a batch tool would hide per-item failures. Revisit only with a demonstrated analyst workflow.                                                                    |

## 6. Integration checklist for any new public function

This is the concrete cost of adding one tool. It is easy to underestimate; the
repository's gates catch each omission.

1. **Contract** — add the entry in the owning
   `src/contracts/<family>ToolContracts.ts` using the existing `session(...)` or
   `tool(...)` helper; export the array and include it in
   `src/contracts/toolContracts.ts`.
2. **Description** — follow `docs/tool-design.md`: what is observed, what is
   unknown, what it does not claim. Check the execution-wording rule in
   `src/contracts/toolEffects.test.ts`; descriptions saying "run/launch/execute/
   start/install" require declared effects or a justified exception.
3. **Effects** — add the explicit entry in `src/contracts/toolEffects.ts`. The
   audit test fails if a contract has no entry or an entry has no contract.
4. **Output schema** — add the entry in
   `src/contracts/toolOutputSchemaGroups.ts` (`lifecycleResultOf` for session
   envelopes, `evidenceResultOf` for provider-obtained results).
5. **Examples** — add required-input examples to
   `src/contracts/toolContractExamples.ts`; `advertisedInputExamples.test.ts`
   validates them.
6. **Input schema** — put it beside the contract or in the domain module; keep
   it strict. If the compact advertisement profile needs special handling, check
   `src/contracts/inputSchemaPresentation.ts` and `compactInputSchema.test.ts`.
7. **Registration** — register in the right `src/server/register*Tools.ts` with
   `toolRegistrationOptions` and the existing admission/delivery helpers. Do not
   bypass `ToolResultDelivery` budgets.
8. **CLI** — add the command (kebab-case of the tool name) in `src/cli/*Commands.ts`
   and list it in `CLI_COMMAND_NAMES`; or alias it in
   `CLI_COMMAND_TOOL_ALIASES`; or add it to `MCP_TOOLS_WITHOUT_DEDICATED_CLI`
   with a comment explaining why. `cliToolCoverage.test.ts` enforces this.
9. **Docs** — add or extend a guide, update `docs/mcp-contracts.md` where the
   runtime contract changes, and add the page to `docs/.vitepress/config.ts`. If
   the README gains a documentation link, update all 21 translated READMEs in
   `docs/readme/` so `scripts/check-doc-facts.mjs` keeps passing.
10. **Generated artifacts** — `npm run build` (skills artifact plus compile),
    `npm run docs:generate` (product catalog), and `npm run licenses:generate` if
    dependencies changed. The generated product catalog is how counts and
    families reach the README and the docs check.
11. **Tests** — unit tests in the domain module, a contract test for input and
    output schemas, effect and CLI-coverage tests, a determinism test where the
    output is digest-bound, and a real-provider test where the claim depends on a
    provider.
12. **Gates** — `npm run check`, `npm run docs:check`, and the affected test
    suites. For provider-dependent claims, the lane named in
    `docs/testing.md#real-toolchain-verification-lanes`.

Surface budget: seven MCP tools in this document would take the catalog from
224 to 231. The project's guidance is to extend first; a reviewer should be able
to point at the distinct analyst question each new name answers.

## 7. What is needed

These are the practical prerequisites, roughly in the order they block work.

### 7.1 Fixtures and samples

- A tiny deterministic native fixture with a known three-level call chain, a
  recursive edge, and one unresolved indirect call — used by F1, F2, F3, F5, F6.
  Reuse the conventions in `tests/fixtures/` and the existing fake-provider
  harnesses (`tests/fixtures/*McpHarness.ts`).
- A second build of the same fixture with one changed function body for F2 and
  F9.
- A recorded Evidence bundle pair: one complete, one with a truncated
  relationship read and one unresolved unknown, for the fail-closed matrix.
- A fixture that sets sentinel environment values, for the F4 secrecy test.
- A hostile-string fixture (target-supplied names containing Markdown and HTML)
  for F7 escaping.

### 7.2 Providers and toolchains

- Ghidra and a JDK for the real-provider parts of F5/F8; those lanes already
  exist in CI but need a local run before claiming verification.
- A second engine (IDA, Hopper, or Kuna) for F8. Without it, F8 can only ship its
  fake-provider tests, which do not establish cross-provider semantics.
- Chrome for any chart or report visual check; ffmpeg/ffprobe only if a report
  embeds video (it should not).

### 7.3 Shared code to extract first

- A session bundle accessor that returns the authenticated bundle plus unknown
  ledger in one object (today the registration code assembles it per tool).
- An operation taxonomy module used by F3 and the docs, with a test that every
  tool declares its Evidence operation.
- A deterministic aggregate helper (counts by operation, confidence, coverage)
  shared by F3, F6, and F7 so the numbers cannot diverge.
- A renderer for report sections that takes only validated facts, so F7 cannot
  read session state directly.

### 7.4 Documentation and translation

- One guide page per function, or one combined "investigation audit" page for
  F1–F3, plus sidebar entries.
- README documentation links only when a new guide is published, followed by the
  translated README update. Link parity is enforced, so a README-only change
  fails `docs:check`.
- `docs/mcp-contracts.md` updates for any new envelope, limit, or error code.

### 7.5 CI and verification budget

- Determinism tests are cheap; real-provider lanes are not. Put F8 and F9 behind
  the existing real-toolchain lanes rather than inventing a new one.
- F2 and F3 should run against fixtures in the default suite; F8 needs the
  provider lane; F9 needs only the fake provider.
- Add a budget test for each new tool (result size, truncation behaviour) using
  the existing `ToolResultDelivery` test helpers.

### 7.6 Decisions the owner must make

- Whether F1/F2/F3 are MCP-only (with the `MCP_TOOLS_WITHOUT_DEDICATED_CLI`
  reason) or get CLI commands over exported bundles. The CLI path is more useful
  for reviewers, but it doubles the surface.
- Whether F7's CLI writes Markdown only or also HTML. HTML needs escaping rules
  and a size ceiling; Markdown is enough for a first version.
- Whether F8 belongs in the public catalog at all, or stays a repository script
  until a second provider is routinely configured. This is the largest scope
  decision here.

## 8. Suggested sequence

| Phase | Items                                     | Outcome                                                                | Gate                                  |
| ----- | ----------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------- |
| 0     | Shared extraction in 7.3, fixtures in 7.1 | One bundle accessor, one taxonomy, one aggregate helper                | `npm run check`                       |
| 1     | F1, F4                                    | Provenance and environment diagnosis without new provider work         | `npm run check`, `npm run docs:check` |
| 2     | F2, F3                                    | Audit and bundle comparison; the fail-closed matrix is the deliverable | default suite plus fixtures           |
| 3     | F6, F7                                    | Presentation layer on top of F3                                        | determinism and escaping tests        |
| 4     | F5, F9                                    | Path-aware unknowns and the watcher                                    | fake-provider tests; cancellation     |
| 5     | F8                                        | Cross-provider comparison                                              | real-provider lane                    |

Rationale: F1 and F4 add no provider calls and no new Evidence semantics, so they
are the cheapest way to validate the integration checklist. F2 and F3 carry the
actual analytical value and the fail-closed rules. F6 and F7 are pure projections
and must wait for F3 so the numbers have one owner. F5 and F9 add traversal and
lifecycle complexity. F8 is last because its cost is provider engineering, not
contract design.

## 9. Risks and non-goals

- **False certainty.** The largest risk is a summary that reads as a completeness
  claim. Every proposal above must report coverage per operation and must keep
  `unknown` visible.
- **Catalog growth.** Each new tool is a permanent documentation and compatibility
  obligation. The seven proposals are a menu, not a batch to implement.
- **Cross-provider claims.** F8 can easily produce a "disagreement" that is just
  a version or option difference. The profile commitment check is the mitigation,
  and it must be in the first version.
- **Report drift.** F7's template can silently diverge from the contracts it
  summarises. Keep section content generated from validated facts, not prose
  strings assembled in a server handler.
- **Watcher lifecycle.** F9 touches process and session cleanup, the area with the
  most platform-specific failure modes in this repository. It needs cancellation
  and cleanup tests before any feature work.
- **Non-goals:** new chart kinds, semantic search, automatic remediation, a
  public conformance evaluator, and any function that mutates the target.

## 10. Open questions

1. Should F1–F3 share one "investigation audit" family and one guide, or stay
   three independent tools with three guides?
2. Does the project want a machine-readable report schema (for F7) that other
   tools can consume, or is Markdown the only deliverable?
3. Is there a second provider the maintainers already run routinely? If not, F8
   should stay a repository verification script.
4. Should the operation taxonomy in 7.3 be generated from the tool contracts
   (so it cannot drift) or declared once and checked by a test?
5. For F2, is comparing against a supplied bundle file acceptable, or should the
   session retain an explicit "reference bundle" identity so the comparison can
   be repeated without re-reading the file?

## Appendix A. Sketch of a contract entry

Illustrative only; names and wording would need review against
`docs/tool-design.md`.

```ts
session(
  "explain_evidence_chain",
  "Trace the retained Evidence records one observation rests on. Returns the root reference, linked records, edges, any referenced identifiers absent from the bundle, and explicit truncation. It records no Evidence and does not rank importance; a missing link describes the bundle, not the target.",
  evidenceChainInputSchema,
);
```

```ts
explain_evidence_chain: lifecycleResultOf(evidenceChainResultSchema),
```

```ts
explain_evidence_chain: effects(),
```

## Appendix B. Verification matrix

| Function                         | Unit | Contract | Determinism | Real provider | File effects |
| -------------------------------- | ---- | -------- | ----------- | ------------- | ------------ |
| F1 `explain_evidence_chain`      | yes  | yes      | yes         | no            | no           |
| F2 `compare_evidence_bundles`    | yes  | yes      | yes         | no            | read         |
| F3 `audit_evidence_coverage`     | yes  | yes      | yes         | no            | no           |
| F4 `diagnose_environment`        | yes  | yes      | n/a         | host lane     | no           |
| F5 `project_unknown_impact`      | yes  | yes      | yes         | Ghidra        | no           |
| F6 `render_session_chart`        | yes  | yes      | yes         | no            | no           |
| F7 `export_investigation_report` | yes  | yes      | yes         | no            | CLI write    |
| F8 `compare-providers`           | yes  | n/a      | n/a         | two engines   | no           |
| F9 `watch`                       | yes  | n/a      | yes         | optional      | read         |
