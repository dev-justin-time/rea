import { z } from "zod";

import { digestCanonicalValue } from "./canonicalDigest.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { prefixedDigestSchema } from "./digests.js";
import { jsonObjectSchema } from "./jsonValue.js";

/** Caller-selected unknowns and traversal budget. */
export const unknownImpactInputSchema = z.strictObject({
  unknown_ids: z
    .array(prefixedDigestSchema("unk"))
    .max(32)
    .default([])
    .describe(
      "Unknown identifiers to project; an empty list projects every unresolved Unknown",
    ),
  max_nodes: z.int().min(1).max(256).default(128),
});

export type UnknownImpactInput = z.output<typeof unknownImpactInputSchema>;

const affectSchema = z.strictObject({
  kind: z.enum(["evidence", "procedure", "subject", "location"]),
  id: z.string().min(1),
  proven: z.boolean(),
  evidence_id: prefixedDigestSchema("ev"),
});

const projectedUnknownSchema = z.strictObject({
  unknown_id: prefixedDigestSchema("unk"),
  revision: z.int().min(1),
  status: z.enum([
    "open",
    "investigating",
    "blocked",
    "contradicted",
    "resolved",
  ]),
  severity: z.enum(["low", "medium", "high", "critical"]),
  domain: z.string().min(1),
  question: z.string().min(1),
  affects: z.array(affectSchema),
  recommended_probes: z.array(
    z.strictObject({
      operation: z.string().min(1),
      rationale: z.string().min(1),
    }),
  ),
  no_observed_dependency: z.boolean(),
});

/** Unknowns joined to the retained observations that cite or contradict them. */
export const unknownImpactResultSchema = z.strictObject({
  projection_id: prefixedDigestSchema("ui"),
  unknowns: z.array(projectedUnknownSchema),
  missing_unknown_ids: z.array(prefixedDigestSchema("unk")),
  effects_omitted: z.int().min(0),
  truncated: z.boolean(),
  limitations: z.array(z.string()),
});

export type UnknownImpactResult = z.output<typeof unknownImpactResultSchema>;

const PROCEDURE_OPERATIONS = new Set([
  "analyze_function",
  "build_call_path",
  "get_call_graph",
  "procedure_assembly",
  "procedure_callees",
  "procedure_callers",
  "procedure_info",
  "procedure_pseudo_code",
  "procedure_references",
  "read_function_instructions",
  "trace_call_path",
  "xrefs",
]);

const parameterText = (
  parameters: unknown,
  key: string,
): string | undefined => {
  const parsed = jsonObjectSchema.safeParse(parameters);
  if (!parsed.success) return undefined;
  const value = parsed.data[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
};

/**
 * Project each unknown onto the Evidence identifiers it cites and the
 * observations those records identify. This is retained-Evidence traversal:
 * it makes no provider call, follows no call edge, and therefore reports no
 * runtime impact.
 */
export const projectUnknownImpact = (
  bundle: EvidenceBundle,
  input: UnknownImpactInput,
): UnknownImpactResult => {
  const byId = new Map(
    bundle.records.map((record) => [record.evidence_id, record]),
  );
  const requested =
    input.unknown_ids.length === 0
      ? bundle.unknowns
          .filter((unknown) => unknown.status !== "resolved")
          .map((unknown) => unknown.unknown_id)
      : input.unknown_ids;
  const known = new Set(bundle.unknowns.map((unknown) => unknown.unknown_id));
  const missing = uniqueSorted(requested.filter((id) => !known.has(id)));
  const selected = new Set(requested);
  let budget = input.max_nodes;
  let omitted = 0;
  const unknowns: UnknownImpactResult["unknowns"] = [];
  for (const unknown of bundle.unknowns) {
    if (!selected.has(unknown.unknown_id)) continue;
    const evidenceIds = uniqueSorted([
      ...unknown.supporting_evidence_ids,
      ...unknown.contradicting_evidence_ids,
    ]);
    const affects: UnknownImpactResult["unknowns"][number]["affects"] = [];
    const add = (affect: (typeof affects)[number]) => {
      if (budget === 0) {
        omitted += 1;
        return;
      }
      budget -= 1;
      affects.push(affect);
    };
    for (const evidenceId of evidenceIds) {
      const record = byId.get(evidenceId);
      add({
        kind: "evidence",
        id: evidenceId,
        proven: record !== undefined,
        evidence_id: evidenceId,
      });
      if (record === undefined) continue;
      const procedure = PROCEDURE_OPERATIONS.has(record.operation)
        ? (parameterText(record.parameters, "procedure") ??
          parameterText(record.parameters, "address"))
        : undefined;
      if (procedure !== undefined)
        add({
          kind: "procedure",
          id: procedure,
          proven: true,
          evidence_id: evidenceId,
        });
      if (record.subject !== null)
        add({
          kind: "subject",
          id: `${record.subject.name}@${record.subject.digest.sha256}`,
          proven: true,
          evidence_id: evidenceId,
        });
      for (const location of record.locations)
        add({
          kind: "location",
          id:
            location.kind === "address"
              ? location.address
              : location.kind === "address-range"
                ? `${location.start}-${location.end}`
                : location.kind === "artifact-path"
                  ? location.path
                  : location.kind === "file-offset"
                    ? `file-offset:${String(location.offset)}`
                    : `file-offset:${String(location.start)}-${String(location.end)}`,
          proven: true,
          evidence_id: evidenceId,
        });
    }
    unknowns.push({
      unknown_id: unknown.unknown_id,
      revision: unknown.revision,
      status: unknown.status,
      severity: unknown.severity,
      domain: unknown.domain,
      question: unknown.question,
      affects,
      recommended_probes: unknown.recommended_probes.map((probe) => ({
        operation: probe.operation,
        rationale: probe.rationale,
      })),
      no_observed_dependency: evidenceIds.length === 0,
    });
  }
  return unknownImpactResultSchema.parse({
    projection_id: `ui_${digestCanonicalValue(
      {
        unknowns: unknowns.map((unknown) => unknown.unknown_id),
        affects: unknowns.flatMap((unknown) => unknown.affects),
      },
      "Unknown impact projection",
    )}`,
    unknowns,
    missing_unknown_ids: missing,
    effects_omitted: omitted,
    truncated: omitted > 0,
    limitations: [
      "This projection follows Unknown claims and retained Evidence references only. It does not traverse call edges; use build_call_path or trace_call_path for path membership.",
      "A cited Evidence identifier that is no longer retained is reported with proven=false; it is not replaced by inference.",
      "Affected procedures come from observation parameters, not from runtime behavior.",
      ...(omitted > 0
        ? [
            `The node budget omitted ${String(omitted)} effects; raise max_nodes or project fewer Unknowns.`,
          ]
        : []),
    ],
  });
};
