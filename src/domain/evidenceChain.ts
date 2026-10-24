import { z } from "zod";

import { AnalysisInputError } from "./analysisErrorCore.js";
import { digestCanonicalValue } from "./canonicalDigest.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import { evidenceLocationSchema, type Evidence } from "./evidence.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { digestSchema, prefixedDigestSchema } from "./digests.js";
import { err, ok, type Result } from "./result.js";
import { compareUnicodeCodePoints } from "./unicodeCodePointOrder.js";

const evidenceIdSchema = prefixedDigestSchema("ev");

/** Caller-selected provenance root and traversal budget. */
export const evidenceChainInputSchema = z.strictObject({
  evidence_id: evidenceIdSchema.describe(
    "A retained Evidence identifier whose provenance should be explained",
  ),
  direction: z
    .enum(["ancestors", "descendants", "both"])
    .default("ancestors")
    .describe(
      "Follow the records this observation rests on, the observations that cite it, or both",
    ),
  max_depth: z.int().min(1).max(8).default(3),
  max_records: z.int().min(1).max(200).default(50),
});

const chainNodeSchema = z.strictObject({
  evidence_id: evidenceIdSchema,
  operation: z.string().min(1),
  predicate_type: z.string().min(1),
  confidence: z.enum(["observed", "derived", "inferred"]),
  authority: z.string().min(1),
  depth: z.int().min(0),
  subject: z.string().nullable(),
  subject_sha256: digestSchema.nullable(),
  locations: z.array(evidenceLocationSchema),
  limitations: z.array(z.string()),
});

const chainRootSchema = chainNodeSchema.omit({ depth: true });

const chainEdgeSchema = z.strictObject({
  from: evidenceIdSchema,
  to: evidenceIdSchema,
});

/** One bounded, direction-aware view of the retained provenance graph. */
export const evidenceChainResultSchema = z.strictObject({
  chain_id: prefixedDigestSchema("ec"),
  direction: z.enum(["ancestors", "descendants", "both"]),
  root: chainRootSchema,
  nodes: z.array(chainNodeSchema),
  edges: z.array(chainEdgeSchema),
  missing_links: z.array(evidenceIdSchema),
  truncated: z.boolean(),
  omitted: z.strictObject({
    records: z.int().min(0),
    links: z.int().min(0),
  }),
  limitations: z.array(z.string()),
});

export type EvidenceChainResult = z.output<typeof evidenceChainResultSchema>;

const nodeFields = (evidence: Evidence) => ({
  evidence_id: evidence.evidence_id,
  operation: evidence.operation,
  predicate_type: evidence.predicate_type,
  confidence: evidence.confidence,
  authority: evidence.authority,
  subject: evidence.subject?.name ?? null,
  subject_sha256: evidence.subject?.digest.sha256 ?? null,
  locations: evidence.locations.map((location) => ({ ...location })),
  limitations: [...evidence.limitations],
});

const nodeOf = (evidence: Evidence, depth: number) => ({
  ...nodeFields(evidence),
  depth,
});

/**
 * Traverse retained `evidence_links` without a provider call. Links name the
 * observations a record rests on; the reverse index answers who cites a record.
 * Ordering is explicit (depth, then identifier), because Evidence carries no
 * observation timestamp.
 */
export const explainEvidenceChain = (
  inputValue: unknown,
  bundle: EvidenceBundle,
): Result<EvidenceChainResult, AnalysisInputError> => {
  const input = evidenceChainInputSchema.parse(inputValue);
  const byId = new Map(
    bundle.records.map((record) => [record.evidence_id, record]),
  );
  const root = byId.get(input.evidence_id);
  if (root === undefined)
    return err(
      new AnalysisInputError(
        "explain_evidence_chain",
        {
          userMessage: `Evidence ${input.evidence_id} is not retained in this session. Read retained identifiers with get_evidence_bundle or search_evidence first.`,
        },
        [
          {
            path: ["evidence_id"],
            reason: "invalid_value",
            message: "not retained in this session",
          },
        ],
      ),
    );

  const citing = new Map<string, string[]>();
  for (const record of bundle.records)
    for (const link of record.evidence_links) {
      const list = citing.get(link) ?? [];
      list.push(record.evidence_id);
      citing.set(link, list);
    }

  const depths = new Map<string, number>([[root.evidence_id, 0]]);
  const missing = new Set<string>();
  let frontier = [root.evidence_id];
  for (
    let depth = 0;
    depth < input.max_depth && frontier.length > 0;
    depth += 1
  ) {
    const next: string[] = [];
    for (const id of frontier) {
      const record = byId.get(id);
      if (record === undefined) continue;
      const linked =
        input.direction === "ancestors"
          ? record.evidence_links
          : input.direction === "descendants"
            ? (citing.get(id) ?? [])
            : [...record.evidence_links, ...(citing.get(id) ?? [])];
      for (const target of uniqueSorted(linked))
        if (!byId.has(target)) missing.add(target);
        else if (!depths.has(target)) {
          depths.set(target, depth + 1);
          next.push(target);
        }
    }
    frontier = next;
  }

  const discovered = [...depths]
    .sort(([leftId, leftDepth], [rightId, rightDepth]) =>
      leftDepth === rightDepth
        ? compareUnicodeCodePoints(leftId, rightId)
        : leftDepth - rightDepth,
    )
    .map(([id]) => id);
  const included = discovered.slice(0, input.max_records);
  const includedIds = new Set(included);
  const nodes = included.map((id) => nodeOf(byId.get(id)!, depths.get(id)!));
  const edges: Array<{ from: string; to: string }> = [];
  let omittedLinks = 0;
  for (const id of included) {
    const record = byId.get(id)!;
    for (const link of record.evidence_links) {
      if (!byId.has(link)) continue;
      if (includedIds.has(link)) edges.push({ from: id, to: link });
      else omittedLinks += 1;
    }
  }
  edges.sort(
    (left, right) =>
      compareUnicodeCodePoints(left.from, right.from) ||
      compareUnicodeCodePoints(left.to, right.to),
  );
  const omittedRecords = discovered.length - included.length;
  const truncated = omittedRecords > 0 || omittedLinks > 0;
  const result = evidenceChainResultSchema.parse({
    chain_id: `ec_${digestCanonicalValue(
      { root: root.evidence_id, nodes: included, edges },
      "Evidence chain",
    )}`,
    direction: input.direction,
    root: chainRootSchema.parse(nodeFields(root)),
    nodes,
    edges,
    missing_links: [...missing].sort(),
    truncated,
    omitted: { records: omittedRecords, links: omittedLinks },
    limitations: [
      ...(truncated
        ? [
            "The traversal reached a record or link budget; omitted.count reports what was not expanded. Reduce max_depth or query a returned evidence_id directly.",
          ]
        : []),
      ...(missing.size > 0
        ? [
            "Some linked identifiers are not retained in this bundle; they are reported in missing_links rather than treated as absent observations.",
          ]
        : []),
      "Provenance follows retained evidence_links only. It does not establish that the root observation is true or complete.",
    ],
  });
  return ok(result);
};
