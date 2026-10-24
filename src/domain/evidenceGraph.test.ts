import { describe, expect, it } from "vitest";

import { compareEvidenceBundles } from "./evidenceBundleComparison.js";
import { explainEvidenceChain } from "./evidenceChain.js";
import {
  fixtureBundle,
  fixtureEvidence,
} from "./investigationAudit.fixture.js";

const chain = () => {
  const base = fixtureEvidence({ operation: "read_bytes" });
  const middle = fixtureEvidence({
    operation: "procedure_info",
    evidenceLinks: [base.evidence_id],
  });
  const top = fixtureEvidence({
    operation: "build_call_path",
    evidenceLinks: [middle.evidence_id, base.evidence_id],
  });
  return { base, middle, top, bundle: fixtureBundle([base, middle, top]) };
};

describe("explain_evidence_chain", () => {
  it("returns the bounded provenance set with explicit edges", () => {
    const { base, middle, top, bundle } = chain();
    const result = explainEvidenceChain(
      { evidence_id: top.evidence_id },
      bundle,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.root.evidence_id).toBe(top.evidence_id);
    expect(result.value.nodes.map((node) => node.evidence_id).sort()).toEqual(
      [base.evidence_id, middle.evidence_id, top.evidence_id].sort(),
    );
    expect(result.value.edges).toEqual(
      expect.arrayContaining([
        { from: top.evidence_id, to: middle.evidence_id },
        { from: top.evidence_id, to: base.evidence_id },
        { from: middle.evidence_id, to: base.evidence_id },
      ]),
    );
    expect(result.value.truncated).toBe(false);
    expect(result.value.chain_id).toMatch(/^ec_[a-f0-9]{64}$/u);
  });

  it("reports a linked identifier that the bundle does not retain", () => {
    const missing = `ev_${"f".repeat(64)}`;
    const root = fixtureEvidence({
      operation: "trace_feature",
      evidenceLinks: [missing],
    });
    const result = explainEvidenceChain(
      { evidence_id: root.evidence_id },
      fixtureBundle([root]),
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.missing_links).toEqual([missing]);
    expect(result.value.limitations.join(" ")).toContain("missing_links");
  });

  it("fails closed for a root that is not retained", () => {
    const result = explainEvidenceChain(
      { evidence_id: `ev_${"0".repeat(64)}` },
      fixtureBundle([]),
    );
    expect(result.ok).toBe(false);
  });

  it("reports a record cap instead of silently truncating", () => {
    const { top, bundle } = chain();
    const result = explainEvidenceChain(
      { evidence_id: top.evidence_id, max_records: 2 },
      bundle,
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.truncated).toBe(true);
    expect(result.value.omitted.records).toBe(1);
  });
});

describe("compare_evidence_bundles", () => {
  const input = { path: "/tmp/reference.json", max_groups: 32 };

  it("pairs identical observations and reports a changed result", () => {
    const stable = fixtureEvidence({ operation: "read_bytes" });
    const changedBefore = fixtureEvidence({
      operation: "procedure_info",
      parameters: { procedure: "main" },
      result: { address: "0x1000" },
    });
    const changedAfter = fixtureEvidence({
      operation: "procedure_info",
      parameters: { procedure: "main" },
      result: { address: "0x2000" },
    });
    const result = compareEvidenceBundles(
      fixtureBundle([stable, changedBefore]),
      fixtureBundle([stable, changedAfter]),
      input,
    );
    expect(result.status).toBe("compatible");
    expect(result.totals.identical).toBe(1);
    expect(result.totals.changed).toBe(1);
    expect(result.examples).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "changed",
          evidence_id: changedBefore.evidence_id,
        }),
      ]),
    );
  });

  it("withholds record deltas when targets differ", () => {
    const left = fixtureEvidence({ operation: "read_bytes" });
    const right = fixtureEvidence({ operation: "read_bytes" }, "2".repeat(64));
    const result = compareEvidenceBundles(
      fixtureBundle([left]),
      fixtureBundle([right]),
      input,
    );
    expect(result.status).toBe("incompatible");
    expect(result.compatibility.target).toBe("different");
    expect(result.groups).toEqual([]);
    expect(result.limitations.join(" ")).toContain("withheld");
  });

  it("keeps unmatched records separate from an absence claim", () => {
    const left = fixtureEvidence({ operation: "read_bytes" });
    const right = fixtureEvidence({ operation: "search_strings" });
    const result = compareEvidenceBundles(
      fixtureBundle([left]),
      fixtureBundle([right]),
      input,
    );
    expect(result.status).toBe("compatible");
    expect(result.totals.current_only).toBe(1);
    expect(result.totals.reference_only).toBe(1);
    expect(result.limitations.join(" ")).toContain(
      "Unmatched records are not an absence claim",
    );
  });
});
