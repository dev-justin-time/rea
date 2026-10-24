import { z } from "zod";

import { digestCanonicalValue } from "./canonicalDigest.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { prefixedDigestSchema } from "./digests.js";

/** Caller-selected view of the retained evidence audit. */
export const auditEvidenceCoverageInputSchema = z.strictObject({
  focus: z
    .enum(["all", "native", "runtime", "comparison", "unknowns"])
    .default("all")
    .describe(
      "Limit reported gaps to one investigation lane, or report every retained gap",
    ),
  include_remediation: z.boolean().default(true),
});

export type AuditEvidenceCoverageInput = z.output<
  typeof auditEvidenceCoverageInputSchema
>;

const operationSchema = z.strictObject({
  operation: z.string().min(1),
  records: z.int().min(0),
  observed: z.int().min(0),
  derived: z.int().min(0),
  inferred: z.int().min(0),
  coverage: z.strictObject({
    complete: z.int().min(0),
    partial: z.int().min(0),
    unknown: z.int().min(0),
    absent: z.int().min(0),
  }),
  contradictions: z.int().min(0),
});

const gapSchema = z.strictObject({
  gap_id: prefixedDigestSchema("gap"),
  kind: z.enum([
    "incomplete-coverage",
    "unresolved-unknown",
    "contradiction",
    "missing-observation",
  ]),
  affects: z.array(z.string()),
  evidence_ids: z.array(prefixedDigestSchema("ev")),
  closing_observation: z.string().nullable(),
});

/** Per-operation coverage and the gaps that remain in the retained session. */
export const evidenceCoverageAuditResultSchema = z.strictObject({
  audit_id: prefixedDigestSchema("ea"),
  focus: z.enum(["all", "native", "runtime", "comparison", "unknowns"]),
  totals: z.strictObject({
    records: z.int().min(0),
    observed: z.int().min(0),
    derived: z.int().min(0),
    inferred: z.int().min(0),
  }),
  operations: z.array(operationSchema),
  gaps: z.array(gapSchema),
  unknowns: z.strictObject({
    open: z.int().min(0),
    resolved: z.int().min(0),
    contradicted: z.int().min(0),
    with_recommended_probes: z.int().min(0),
  }),
  limitations: z.array(z.string()),
});

export type EvidenceCoverageAuditResult = z.output<
  typeof evidenceCoverageAuditResultSchema
>;

/** Coarse operation families; new tool names can be added without migration. */
const LANE_OPERATIONS = {
  native: [
    "address_to_file_offset",
    "analyze_function",
    "analyze_swift_types",
    "binary_overview",
    "build_call_path",
    "demangle_swift",
    "get_call_graph",
    "inspect_binary_layout",
    "inspect_elf_notes",
    "inspect_macho",
    "inspect_native_exports",
    "inspect_native_instruction",
    "inspect_native_load_image",
    "inspect_signature",
    "procedure_assembly",
    "procedure_callees",
    "procedure_callers",
    "procedure_info",
    "procedure_pseudo_code",
    "procedure_references",
    "read_bytes",
    "read_function_instructions",
    "resolve_native_call_targets",
    "search_bytes",
    "search_procedures",
    "search_strings",
    "trace_call_path",
    "trace_feature",
    "xrefs",
  ],
  runtime: [
    "capture_browser_scenario",
    "capture_native_ui_scenario",
    "capture_process_scenario",
    "instrument_with_frida",
    "observe_javascript_runtime",
    "observe_native_calls",
    "observe_native_ui",
    "observe_web_execution",
    "observe_web_session",
  ],
  comparison: [
    "compare_application_versions",
    "compare_artifacts",
    "compare_bundles",
    "compare_functions",
    "compare_javascript_export_shapes",
    "compare_managed_members",
    "compare_process_captures",
    "compare_source_to_bundle",
    "compare_web_captures",
    "compare_web_screenshots",
    "correlate_static_and_runtime",
    "find_changed_behavior",
  ],
} as const;

const gapId = (
  kind: string,
  affects: readonly string[],
  evidenceIds: readonly string[],
): string =>
  `gap_${digestCanonicalValue(
    {
      kind,
      affects: [...affects].sort(),
      evidence_ids: [...evidenceIds].sort(),
    },
    "Evidence coverage gap",
  )}`;

const closingObservation = (
  kind: "incomplete-coverage" | "unresolved-unknown" | "contradiction",
  operation: string | undefined,
  probe: string | undefined,
): string => {
  switch (kind) {
    case "incomplete-coverage":
      return `Read the missing caller and callee relationship set for ${operation ?? "this observation"} with procedure_callers, procedure_callees, or analyze_function, then repeat the query.`;
    case "contradiction":
      return `Resolve the contradictory observations with an independent read that cites both records; do not average or discard either one.`;
    case "unresolved-unknown":
      return probe === undefined
        ? "Record a probe that can observe the missing behavior, then update the unknown with the resulting Evidence."
        : `Run ${probe} to close this unknown, then update it with the resulting Evidence.`;
  }
};

/**
 * Summarise retained coverage without querying a provider. Missing records are
 * reported as gaps, never as absence, and the lane classification is disclosed
 * because new tools can add operations this module does not recognise.
 */
export const auditEvidenceCoverage = (
  bundle: EvidenceBundle,
  input: AuditEvidenceCoverageInput,
): EvidenceCoverageAuditResult => {
  const lane =
    input.focus === "all" || input.focus === "unknowns"
      ? undefined
      : new Set<string>(LANE_OPERATIONS[input.focus]);
  const operations = new Map<
    string,
    {
      operation: string;
      records: number;
      observed: number;
      derived: number;
      inferred: number;
      complete: number;
      partial: number;
      unknown: number;
      absent: number;
      contradictions: number;
    }
  >();
  const ensure = (operation: string) => {
    let entry = operations.get(operation);
    if (entry === undefined) {
      entry = {
        operation,
        records: 0,
        observed: 0,
        derived: 0,
        inferred: 0,
        complete: 0,
        partial: 0,
        unknown: 0,
        absent: 0,
        contradictions: 0,
      };
      operations.set(operation, entry);
    }
    return entry;
  };
  for (const record of bundle.records) {
    const entry = ensure(record.operation);
    entry.records += 1;
    entry[record.confidence] += 1;
    const coverage = record.relationship_coverage?.status;
    if (coverage === undefined) entry.absent += 1;
    else entry[coverage] += 1;
  }

  const evidenceOperations = new Map(
    bundle.records.map((record) => [record.evidence_id, record.operation]),
  );
  const gaps: EvidenceCoverageAuditResult["gaps"] = [];
  const seen = new Set<string>();
  const addGap = (gap: EvidenceCoverageAuditResult["gaps"][number]) => {
    if (seen.has(gap.gap_id)) return;
    seen.add(gap.gap_id);
    gaps.push(gap);
  };
  for (const record of bundle.records) {
    if (record.relationship_coverage?.status === "complete") continue;
    if (record.relationship_coverage === null) continue;
    if (lane !== undefined && !lane.has(record.operation)) continue;
    addGap({
      gap_id: gapId(
        "incomplete-coverage",
        [record.operation],
        [record.evidence_id],
      ),
      kind: "incomplete-coverage",
      affects: [record.operation],
      evidence_ids: [record.evidence_id],
      closing_observation: input.include_remediation
        ? closingObservation("incomplete-coverage", record.operation, undefined)
        : null,
    });
  }

  let open = 0;
  let resolved = 0;
  let contradicted = 0;
  let withProbes = 0;
  for (const unknown of bundle.unknowns) {
    if (unknown.status === "resolved") resolved += 1;
    else open += 1;
    if (unknown.status === "contradicted") contradicted += 1;
    if (unknown.recommended_probes.length > 0) withProbes += 1;
    if (unknown.status === "resolved") continue;
    const evidenceIds = uniqueSorted([
      ...unknown.supporting_evidence_ids,
      ...unknown.contradicting_evidence_ids,
    ]);
    const affectedOperations = uniqueSorted(
      evidenceIds.flatMap((id) => {
        const operation = evidenceOperations.get(id);
        return operation === undefined ? [] : [operation];
      }),
    );
    if (
      input.focus !== "unknowns" &&
      lane !== undefined &&
      !affectedOperations.some((operation) => lane.has(operation))
    )
      continue;
    for (const operation of affectedOperations)
      if (operation in operations)
        ensure(operation).contradictions +=
          unknown.status === "contradicted" ? 1 : 0;
    const kind =
      unknown.status === "contradicted"
        ? "contradiction"
        : "unresolved-unknown";
    const probe = unknown.recommended_probes[0]?.operation;
    addGap({
      gap_id: gapId(kind, [unknown.unknown_id], evidenceIds),
      kind,
      affects: [unknown.unknown_id],
      evidence_ids: evidenceIds,
      closing_observation: input.include_remediation
        ? closingObservation(kind, undefined, probe)
        : null,
    });
  }

  const operationList = [...operations.values()]
    .filter((entry) => lane === undefined || lane.has(entry.operation))
    .sort((left, right) =>
      left.operation < right.operation
        ? -1
        : left.operation > right.operation
          ? 1
          : 0,
    );
  if (lane !== undefined && operationList.length === 0)
    addGap({
      gap_id: gapId("missing-observation", [input.focus], []),
      kind: "missing-observation",
      affects: [input.focus],
      evidence_ids: [],
      closing_observation: null,
    });

  const totals = { records: 0, observed: 0, derived: 0, inferred: 0 };
  for (const record of bundle.records) {
    totals.records += 1;
    totals[record.confidence] += 1;
  }
  const sortedGaps = gaps
    .sort((left, right) =>
      left.kind === right.kind
        ? left.gap_id < right.gap_id
          ? -1
          : 1
        : left.kind < right.kind
          ? -1
          : 1,
    )
    .slice(0, 128);
  return evidenceCoverageAuditResultSchema.parse({
    audit_id: `ea_${digestCanonicalValue(
      {
        totals,
        operations: operationList,
        gaps: sortedGaps,
        unknowns: { open, resolved, contradicted, withProbes },
      },
      "Evidence coverage audit",
    )}`,
    focus: input.focus,
    totals,
    operations: operationList,
    gaps: sortedGaps,
    unknowns: {
      open,
      resolved,
      contradicted,
      with_recommended_probes: withProbes,
    },
    limitations: [
      "Coverage is reported per retained operation. No records for an operation is not evidence that the target lacks the behavior.",
      ...(lane === undefined
        ? []
        : [
            "Lane filters classify operations by a built-in family list; a newly registered operation may be omitted until the list is extended.",
          ]),
      "Relationship coverage describes only the provider-observed direct relationship set; it does not claim every possible runtime edge.",
      "This audit records no Evidence and queries no provider.",
    ],
  });
};
