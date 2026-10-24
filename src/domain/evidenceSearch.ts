import { z } from "zod";

import type { Evidence } from "./evidence.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { digestSchema } from "./digests.js";
import {
  evidenceMatchesFilters,
  evidenceRecordFiltersSchema,
} from "./evidenceRecordSummary.js";

const MAX_SCANNED_RECORDS = 5_000;
const MAX_SEARCHABLE_CHARACTERS = 64 * 1024 * 1024;
const MAX_SEARCH_TERMS = 16;
const MAX_SNIPPET_CHARACTERS = 240;

/** Search terms are lexical tokens, not a semantic embedding. */
const searchTokenPattern = /[\p{L}\p{N}_$]+/gu;

const stopWords = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "with",
]);

/** Bounded lexical search over retained Evidence payloads. */
export const searchEvidenceInputSchema = z.strictObject({
  query: z.string().trim().min(1).max(512),
  limit: z.int().min(1).max(50).default(10),
  filters: evidenceRecordFiltersSchema.optional(),
});

export type SearchEvidenceInput = z.infer<typeof searchEvidenceInputSchema>;

/** One ranked retained record; the snippet cites its source payload. */
export const evidenceSearchHitSchema = z.strictObject({
  evidence_id: z.string().min(1),
  operation: z.string().min(1),
  target_sha256: digestSchema.nullable(),
  analysis_profile_digest: digestSchema.nullable(),
  score: z.number().nonnegative(),
  matched_terms: z.array(z.string().min(1)),
  snippet: z.string(),
});

/** Deterministic lexical result over the session's retained Evidence. */
export const evidenceSearchResultSchema = z.strictObject({
  kind: z.literal("evidence-search"),
  query: z.string().min(1),
  total_matches: z.int().nonnegative(),
  scanned_records: z.int().nonnegative(),
  records: z.array(evidenceSearchHitSchema),
  limitations: z.array(z.string().min(1)),
});

export type EvidenceSearchResult = z.infer<typeof evidenceSearchResultSchema>;

const searchTerms = (query: string): readonly string[] => {
  const unique: string[] = [];
  const seen = new Set<string>();
  for (const match of query
    .toLowerCase()
    .normalize("NFKC")
    .matchAll(searchTokenPattern)) {
    const term = match[0];
    if (term.length < 2 || stopWords.has(term) || seen.has(term)) continue;
    seen.add(term);
    unique.push(term);
    if (unique.length === MAX_SEARCH_TERMS) break;
  }
  return unique;
};

const searchableText = (evidence: Evidence): string =>
  JSON.stringify([evidence.operation, evidence.normalized_result]);

const termCounts = (
  text: string,
  terms: ReadonlySet<string>,
): { counts: ReadonlyMap<string, number>; length: number } => {
  const counts = new Map<string, number>();
  let length = 0;
  for (const match of text.toLowerCase().matchAll(searchTokenPattern)) {
    length += 1;
    const term = match[0];
    if (terms.has(term)) counts.set(term, (counts.get(term) ?? 0) + 1);
  }
  return { counts, length };
};

const snippetFor = (text: string, matched: readonly string[]): string => {
  const lower = text.toLowerCase();
  let position = -1;
  for (const term of matched) {
    const index = lower.indexOf(term);
    if (index >= 0 && (position < 0 || index < position)) position = index;
  }
  if (position < 0) return text.slice(0, MAX_SNIPPET_CHARACTERS);
  const start = Math.max(0, position - MAX_SNIPPET_CHARACTERS / 3);
  const end = Math.min(text.length, start + MAX_SNIPPET_CHARACTERS);
  return `${start > 0 ? "…" : ""}${text.slice(start, end)}${
    end < text.length ? "…" : ""
  }`;
};

/**
 * Rank retained records with a BM25-style lexical score. The function is pure
 * and deterministic; it never reads provider state or re-runs analysis.
 */
export const searchEvidenceBundle = (
  bundle: EvidenceBundle,
  input: SearchEvidenceInput,
): EvidenceSearchResult => {
  const terms = searchTerms(input.query);
  const limitations = [
    "Search covers retained Evidence payload text only. It does not query the provider database, restart analysis, or establish semantic relevance to target behavior.",
  ];
  if (terms.length === 0) {
    return {
      kind: "evidence-search",
      query: input.query,
      total_matches: 0,
      scanned_records: 0,
      records: [],
      limitations: [
        ...limitations,
        "The query contains no searchable term of at least two characters; stop words are ignored.",
      ],
    };
  }
  const termSet = new Set(terms);
  const candidates: {
    readonly evidence: Evidence;
    readonly text: string;
    readonly counts: ReadonlyMap<string, number>;
    readonly length: number;
  }[] = [];
  let scanned = 0;
  let characters = 0;
  let stoppedEarly = false;
  for (const evidence of bundle.records) {
    if (
      scanned >= MAX_SCANNED_RECORDS ||
      characters >= MAX_SEARCHABLE_CHARACTERS
    ) {
      stoppedEarly = true;
      break;
    }
    if (!evidenceMatchesFilters(evidence, input.filters)) continue;
    const text = searchableText(evidence);
    const { counts, length } = termCounts(text, termSet);
    candidates.push({ evidence, text, counts, length });
    scanned += 1;
    characters += text.length;
  }
  if (stoppedEarly) {
    limitations.push(
      `Search stopped at ${scanned} records and ${characters} characters; later retained Evidence remains unsearched. Narrow the query with filters or inspect records by evidence_id.`,
    );
  }
  const documentFrequency = new Map<string, number>();
  let totalLength = 0;
  for (const candidate of candidates) {
    totalLength += candidate.length;
    for (const term of candidate.counts.keys())
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
  }
  const averageLength =
    candidates.length === 0 ? 0 : totalLength / candidates.length;
  const scored: {
    readonly evidence: Evidence;
    readonly score: number;
    readonly matched: readonly string[];
    readonly text: string;
  }[] = [];
  for (const candidate of candidates) {
    let score = 0;
    const matched: string[] = [];
    for (const term of terms) {
      const frequency = candidate.counts.get(term);
      if (frequency === undefined) continue;
      matched.push(term);
      const documents = documentFrequency.get(term) ?? 0;
      const inverseDocumentFrequency = Math.log(
        1 + (candidates.length - documents + 0.5) / (documents + 0.5),
      );
      const normalization =
        1 - 0.75 + (0.75 * candidate.length) / Math.max(1, averageLength);
      score +=
        (inverseDocumentFrequency * (frequency * 2.2)) /
        (frequency + 1.2 * normalization);
    }
    if (score > 0) scored.push({ ...candidate, score, matched });
  }
  scored.sort(
    (left, right) =>
      right.score - left.score ||
      left.evidence.evidence_id.localeCompare(right.evidence.evidence_id),
  );
  return {
    kind: "evidence-search",
    query: input.query,
    total_matches: scored.length,
    scanned_records: scanned,
    records: scored
      .slice(0, input.limit)
      .map(({ evidence, score, matched, text }) => ({
        evidence_id: evidence.evidence_id,
        operation: evidence.operation,
        target_sha256: evidence.subject?.digest.sha256 ?? null,
        analysis_profile_digest: evidence.analysis_profile?.digest ?? null,
        score,
        matched_terms: [...matched].sort(),
        snippet: snippetFor(text, matched),
      })),
    limitations,
  };
};
