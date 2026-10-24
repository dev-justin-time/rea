import { z } from "zod";

import { digestCanonicalValue } from "./canonicalDigest.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import type { Evidence } from "./evidence.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { absoluteLocalPathStringSchema } from "./localPath.js";

/** Caller-selected bundle file to compare with the retained session. */
export const compareEvidenceBundlesInputSchema = z.strictObject({
  path: absoluteLocalPathStringSchema.describe(
    "Absolute path of an exported Evidence bundle to compare with the session",
  ),
  max_groups: z.int().min(1).max(64).default(32),
});

export type CompareEvidenceBundlesInput = z.output<
  typeof compareEvidenceBundlesInputSchema
>;

const basisSchema = z.strictObject({
  records: z.int().min(0),
  targets: z.array(z.string()),
  analysis_profiles: z.array(z.string()),
  providers: z.array(z.string()),
});

const comparisonStateSchema = z.enum(["same", "different", "unknown"]);

const groupSchema = z.strictObject({
  operation: z.string().min(1),
  identical: z.int().min(0),
  changed: z.int().min(0),
  current_only: z.int().min(0),
  reference_only: z.int().min(0),
});

const exampleSchema = z.strictObject({
  kind: z.enum(["changed", "current_only", "reference_only"]),
  evidence_id: z.string().min(1),
  operation: z.string().min(1),
});

/** Correspondence and result deltas between two authenticated bundles. */
export const evidenceBundleComparisonResultSchema = z.strictObject({
  status: z.enum(["compatible", "partial", "incompatible"]),
  basis: z.strictObject({ current: basisSchema, reference: basisSchema }),
  compatibility: z.strictObject({
    target: comparisonStateSchema,
    analysis_profile: comparisonStateSchema,
    provider: comparisonStateSchema,
    reasons: z.array(z.string()),
  }),
  groups: z.array(groupSchema),
  examples: z.array(exampleSchema),
  totals: z.strictObject({
    operations: z.int().min(0),
    identical: z.int().min(0),
    changed: z.int().min(0),
    current_only: z.int().min(0),
    reference_only: z.int().min(0),
  }),
  truncated: z.boolean(),
  limitations: z.array(z.string()),
});

export type EvidenceBundleComparisonResult = z.output<
  typeof evidenceBundleComparisonResultSchema
>;

const basisOf = (bundle: EvidenceBundle) => ({
  records: bundle.records.length,
  targets: uniqueSorted(
    bundle.records.flatMap((record) =>
      record.subject === null ? [] : [record.subject.digest.sha256],
    ),
  ),
  analysis_profiles: uniqueSorted(
    bundle.records.flatMap((record) =>
      record.analysis_profile === null
        ? []
        : [
            digestCanonicalValue(
              record.analysis_profile,
              "Evidence analysis profile",
            ),
          ],
    ),
  ),
  providers: uniqueSorted(bundle.records.map((record) => record.provider.id)),
});

const compareSets = (
  left: readonly string[],
  right: readonly string[],
): "same" | "different" | "unknown" => {
  if (left.length === 0 || right.length === 0) return "unknown";
  if (
    left.length === right.length &&
    left.every((value, i) => value === right[i])
  )
    return "same";
  const rightValues = new Set(right);
  return left.every((value) => !rightValues.has(value))
    ? "different"
    : "unknown";
};

/** Identity shared by two records that claim the same observation. */
const correspondenceKey = (record: Evidence): string =>
  digestCanonicalValue(
    [
      record.operation,
      record.provider.id,
      record.subject?.digest.sha256 ?? null,
      digestCanonicalValue(record.parameters, "Evidence parameters"),
      record.analysis_profile === null
        ? null
        : digestCanonicalValue(
            record.analysis_profile,
            "Evidence analysis profile",
          ),
    ],
    "Evidence correspondence",
  );

const resultDigest = (record: Evidence): string =>
  digestCanonicalValue(record.normalized_result, "Evidence result");

/**
 * Pair records by operation, provider, subject, parameters and analysis
 * profile, then compare their observed result. Unmatched records stay
 * unmatched: a bundle that did not cover an operation says nothing about the
 * target's absence.
 */
export const compareEvidenceBundles = (
  current: EvidenceBundle,
  reference: EvidenceBundle,
  input: CompareEvidenceBundlesInput,
): EvidenceBundleComparisonResult => {
  const currentBasis = basisOf(current);
  const referenceBasis = basisOf(reference);
  const target = compareSets(currentBasis.targets, referenceBasis.targets);
  const profile = compareSets(
    currentBasis.analysis_profiles,
    referenceBasis.analysis_profiles,
  );
  const provider = compareSets(
    currentBasis.providers,
    referenceBasis.providers,
  );
  const reasons: string[] = [];
  if (target === "different")
    reasons.push(
      "The bundles describe different target artifacts; their observations are not comparable record by record.",
    );
  if (profile === "different")
    reasons.push(
      "The bundles were produced under different analysis profiles; provider semantics may differ.",
    );
  if (provider === "different")
    reasons.push(
      "The bundles were produced by different providers; a matching result is provider agreement, not the same observation.",
    );
  if (target === "unknown")
    reasons.push(
      "At least one bundle has no unique target digest; target correspondence could not be established.",
    );
  if (profile === "unknown")
    reasons.push(
      "At least one bundle has no unique analysis-profile commitment; provider semantics could not be compared.",
    );
  const status =
    target === "different" || profile === "different"
      ? "incompatible"
      : target === "unknown" || profile === "unknown" || provider === "unknown"
        ? "partial"
        : "compatible";

  const groups: EvidenceBundleComparisonResult["groups"] = [];
  const examples: EvidenceBundleComparisonResult["examples"] = [];
  if (status !== "incompatible") {
    const currentByKey = new Map(
      current.records.map((record) => [correspondenceKey(record), record]),
    );
    const referenceByKey = new Map(
      reference.records.map((record) => [correspondenceKey(record), record]),
    );
    const operations = uniqueSorted([
      ...current.records.map((record) => record.operation),
      ...reference.records.map((record) => record.operation),
    ]);
    for (const operation of operations) {
      const group = {
        operation,
        identical: 0,
        changed: 0,
        current_only: 0,
        reference_only: 0,
      };
      const consider = (record: Evidence, key: string): void => {
        const counterpart = referenceByKey.get(key);
        if (counterpart === undefined) {
          group.current_only += 1;
          if (examples.length < 12)
            examples.push({
              kind: "current_only",
              evidence_id: record.evidence_id,
              operation,
            });
          return;
        }
        if (resultDigest(record) === resultDigest(counterpart))
          group.identical += 1;
        else {
          group.changed += 1;
          if (examples.length < 12)
            examples.push({
              kind: "changed",
              evidence_id: record.evidence_id,
              operation,
            });
        }
      };
      for (const [key, record] of currentByKey)
        if (record.operation === operation) consider(record, key);
      for (const [key, record] of referenceByKey)
        if (record.operation === operation && !currentByKey.has(key)) {
          group.reference_only += 1;
          if (examples.length < 12)
            examples.push({
              kind: "reference_only",
              evidence_id: record.evidence_id,
              operation,
            });
        }
      if (
        group.identical > 0 ||
        group.changed > 0 ||
        group.current_only > 0 ||
        group.reference_only > 0
      )
        groups.push(group);
    }
  }
  const truncated = groups.length > input.max_groups;
  const totals = groups.reduce(
    (sum, group) => ({
      operations: sum.operations + 1,
      identical: sum.identical + group.identical,
      changed: sum.changed + group.changed,
      current_only: sum.current_only + group.current_only,
      reference_only: sum.reference_only + group.reference_only,
    }),
    {
      operations: 0,
      identical: 0,
      changed: 0,
      current_only: 0,
      reference_only: 0,
    },
  );
  return evidenceBundleComparisonResultSchema.parse({
    status,
    basis: { current: currentBasis, reference: referenceBasis },
    compatibility: { target, analysis_profile: profile, provider, reasons },
    groups: groups.slice(0, input.max_groups),
    examples,
    totals,
    truncated,
    limitations: [
      ...(status === "incompatible"
        ? [
            "Record-level deltas were withheld because the bundles are not comparable under the reported basis.",
          ]
        : []),
      "Unmatched records are not an absence claim: the other bundle may not have covered that observation. Only a matching operation, provider, subject, parameter set and analysis profile is paired.",
      ...(truncated
        ? [
            `Only the first ${input.max_groups} operation groups are reported; totals cover every group.`,
          ]
        : []),
      "This comparison records no Evidence and does not merge either bundle into the session.",
    ],
  });
};
