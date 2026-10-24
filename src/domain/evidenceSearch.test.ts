import { describe, expect, it } from "vitest";

import { createEvidence } from "./evidence.js";
import { createEvidenceBundle } from "./evidenceBundle.js";
import { searchEvidenceBundle } from "./evidenceSearch.js";
import type { JsonValue } from "./jsonValue.js";
import type { EvidenceRecordFilters } from "./evidenceRecordSummary.js";

const evidence = (subject: string, operation: string, result: JsonValue) =>
  createEvidence(
    { path: subject, format: "pe", sha256: "a".repeat(64) },
    { id: "provider", name: "Provider", version: "1" },
    { operation, parameters: {}, result },
  );

const bundle = createEvidenceBundle([
  evidence("/fixtures/a.exe", "analyze_function", {
    pseudocode:
      "int check_authorization(char *authorization) { return authorization != 0; }",
  }),
  evidence("/fixtures/b.exe", "procedure_pseudo_code", {
    pseudocode: "int parse_header(void) { return 0; }",
  }),
  evidence("/fixtures/c.exe", "analyze_function", {
    pseudocode: "void report(void) { authorization = 0; }",
  }),
]);

const search = (query: string, limit = 10, filters?: EvidenceRecordFilters) =>
  searchEvidenceBundle(bundle, {
    query,
    limit,
    ...(filters ? { filters } : {}),
  });

describe("retained Evidence search", () => {
  it("ranks documents by lexical relevance and cites matched terms", () => {
    const result = search("authorization");
    expect(result.total_matches).toBe(2);
    expect(result.records).toHaveLength(2);
    expect(
      result.records.every((hit) =>
        hit.matched_terms.includes("authorization"),
      ),
    ).toBe(true);
    expect(result.records[0]?.score).toBeGreaterThanOrEqual(
      result.records[1]?.score ?? 0,
    );
    expect(result.records[0]?.snippet).toContain("authorization");
    expect(result.records[0]?.score).toBeGreaterThan(
      result.records[1]?.score ?? 0,
    );
    expect(
      result.records.every((hit) => hit.target_sha256 === "a".repeat(64)),
    ).toBe(true);
  });

  it("applies exact record filters before scoring", () => {
    const result = search("authorization", 10, {
      operation: "procedure_pseudo_code",
    });
    expect(result.total_matches).toBe(0);
    expect(result.scanned_records).toBe(1);
  });

  it("honors the result limit without changing total matches", () => {
    const result = search("authorization", 1);
    expect(result.total_matches).toBe(2);
    expect(result.records).toHaveLength(1);
  });

  it("returns no hits for a stop-word-only query and says why", () => {
    const result = search("the and of");
    expect(result.total_matches).toBe(0);
    expect(result.records).toEqual([]);
    expect(result.limitations.join(" ")).toContain("stop words");
  });

  it("is deterministic for repeated searches", () => {
    expect(search("authorization")).toEqual(search("authorization"));
  });
});
