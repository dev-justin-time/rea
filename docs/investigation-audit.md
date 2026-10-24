# Evidence audit, diagnosis, charts and reports

Seven read-only MCP tools answer questions about an investigation that spans
many observations. They read the session's retained Evidence, the local
environment, or the chart renderer. None of them queries an analysis provider,
records Evidence, or changes session state.

| Question                                              | Tool                          |
| ----------------------------------------------------- | ----------------------------- |
| Why does REA know this observation?                   | `explain_evidence_chain`      |
| What changed between this session and another bundle? | `compare_evidence_bundles`    |
| Where are the gaps, and what would close them?        | `audit_evidence_coverage`     |
| Why can this host not run the intended operation?     | `diagnose_environment`        |
| Which unresolved Unknowns matter here?                | `project_unknown_impact`      |
| Show the shape of this session                        | `render_session_chart`        |
| Give me a citable dossier                             | `export_investigation_report` |

All seven are MCP-only because they read state that exists inside one session,
or present it without adding an observation. `diagnose_environment` is also
reachable from the CLI through the existing `rea doctor` and `rea capabilities`
commands.

## Provenance

`explain_evidence_chain` follows `evidence_links` from one retained record. Each
record names the observations it rests on, so ancestors answer "what supports
this?" and descendants answer "who cited this?".

The result carries the bounded node set, every edge among included nodes,
`missing_links` for identifiers that are not retained, and explicit truncation.
Ordering is depth then identifier: retained Evidence has no observation
timestamp, so no chronology is implied. A link that is not in the bundle is a
fact about the bundle, not about the target.

## Bundle comparison

`compare_evidence_bundles` reads an exported bundle file and compares it with the
session. Records are paired only when operation, provider, subject, parameters,
and analysis-profile commitment match. Paired records are `identical` or
`changed`; unpaired records are `current_only` or `reference_only`.

Unmatched records are **not** an absence claim: the other bundle may not have
covered that observation. A different target or a different analysis profile
makes the comparison `incompatible`, and record-level deltas are withheld.
The tool never merges the reference bundle into the session.

## Coverage audit

`audit_evidence_coverage` reports per-operation record counts, confidence
classes, relationship-coverage states, unresolved and contradicted Unknowns, and
the evidence-cited gaps that remain. Each gap names the observation that could
close it.

The audit never turns a missing record into an absence statement. `focus` narrows
the reported gaps to a native, runtime, comparison, or unknown lane; lane
classification uses a built-in operation family list, which the result discloses
because a newly registered operation may not be classified yet.

## Environment diagnosis

`diagnose_environment` projects the same read-only checks as `rea doctor`:
provider inspections, runtime configuration, and host restrictions. Each check
reports a status (`available`, `missing`, `unsupported`, `unknown`), its
classification, detail, and remediation.

Diagnosis observes the host, not the target. It never installs, updates, or
repairs a dependency, and it omits secrets such as tokens and bridge descriptors.
Pass `providers` to limit the audit to selected providers.

## Unknown impact

`project_unknown_impact` joins each Unknown to the Evidence identifiers it cites,
then to the procedures, subjects, and source locations those records identify.
A cited identifier that is no longer retained is reported with `proven: false`.

This projection follows claims and Evidence references only. It does not traverse
call edges; use `build_call_path` or `trace_call_path` for path membership, and
treat every result as retained evidence rather than a runtime-impact claim.

## Charts

`render_session_chart` charts one aggregate of the session: records per
operation, Unknowns per status, records per confidence class, or records per
relationship-coverage state. The result returns the same chart schema as
`render_native_chart`, plus the exact values and contributing Evidence
identifiers. Pass `top` to bound the number of charted categories; the result
reports how many were omitted.

The chart is presentation. It adds no observations and records no Evidence.

## Reports

`export_investigation_report` renders deterministic Markdown: target identity,
provider commitments, a per-operation inventory, coverage gaps, unresolved
Unknowns, citations, and — with `include_charts` — an embedded SVG chart.

Identical retained state and inputs produce an identical body and `report_id`.
The report states its record and chart omissions, and it renders no timestamps
because retained Evidence carries none. Export the Evidence bundle when the
complete machine-readable set is needed.

## Limits and failure behavior

- Bundle and Unknown traversal is bounded. Truncation is reported with counts
  and a narrower query as the recovery.
- Charts keep the existing presentation caps (64 bar categories, 4 line series,
  128 nodes, 512 edges).
- A required record that is not retained produces a typed input error with
  recovery text; it is never replaced by inference.
- Environment checks run with the doctor's own timeouts; a check that cannot
  complete becomes `unknown`.

## Verification

```sh
npx vitest run src/domain/evidenceGraph.test.ts src/domain/investigationAudit.test.ts
npx vitest run src/contracts/toolEffects.test.ts src/contracts/advertisedInputExamples.test.ts
npx vitest run src/server/InvestigationAuditMcp.test.ts
npx vitest run tests/boundary/cli/cliToolCoverage.test.ts
```

The domain tests cover linear and diamond provenance, dangling links, caps,
identical and changed comparisons, incompatible bases, incomplete coverage,
unresolved and contradicted Unknowns, chart aggregates, report determinism and
omissions, and environment status normalisation.
