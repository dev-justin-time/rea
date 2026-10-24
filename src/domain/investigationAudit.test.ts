import { describe, expect, it } from "vitest";

import { projectEnvironmentDiagnosis } from "./environmentDiagnosis.js";
import { auditEvidenceCoverage } from "./evidenceCoverageAudit.js";
import { createInvestigationReport } from "./investigationReport.js";
import { renderSessionChart } from "./sessionChart.js";
import { projectUnknownImpact } from "./unknownImpact.js";
import {
  fixtureBundle,
  fixtureEvidence,
  fixtureUnknown,
} from "./investigationAudit.fixture.js";

const auditFixture = () => {
  const record = fixtureEvidence({
    operation: "procedure_callers",
    relationshipCoverage: {
      status: "partial",
      limitations: ["Caller inventory reached the provider limit."],
    },
    locations: [{ kind: "address", address: "0x1000" }],
  });
  const mutation = fixtureEvidence({ operation: "record_unknown" });
  const unknown = fixtureUnknown(mutation.evidence_id, [record.evidence_id]);
  return {
    record,
    mutation,
    unknown,
    bundle: fixtureBundle([record, mutation], [unknown]),
  };
};

describe("audit_evidence_coverage", () => {
  it("reports incomplete coverage and an unresolved Unknown as gaps", () => {
    const { record, unknown, bundle } = auditFixture();
    const result = auditEvidenceCoverage(bundle, {
      focus: "all",
      include_remediation: true,
    });
    expect(result.totals.records).toBe(2);
    expect(result.unknowns.open).toBe(1);
    expect(result.gaps.map((gap) => gap.kind).sort()).toEqual([
      "incomplete-coverage",
      "unresolved-unknown",
    ]);
    expect(result.gaps).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "incomplete-coverage",
          evidence_ids: [record.evidence_id],
        }),
        expect.objectContaining({
          kind: "unresolved-unknown",
          affects: [unknown.unknown_id],
        }),
      ]),
    );
    expect(result.gaps[0]?.gap_id).toMatch(/^gap_[a-f0-9]{64}$/u);
  });

  it("reports no gaps for an empty session", () => {
    const result = auditEvidenceCoverage(fixtureBundle([]), {
      focus: "all",
      include_remediation: false,
    });
    expect(result.operations).toEqual([]);
    expect(result.gaps).toEqual([]);
  });
});

describe("project_unknown_impact", () => {
  it("joins an Unknown to its retained observation and locations", () => {
    const { record, unknown, bundle } = auditFixture();
    const result = projectUnknownImpact(bundle, {
      unknown_ids: [],
      max_nodes: 64,
    });
    expect(result.unknowns).toHaveLength(1);
    expect(result.unknowns[0]?.unknown_id).toBe(unknown.unknown_id);
    expect(result.unknowns[0]?.affects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "evidence",
          id: record.evidence_id,
          proven: true,
        }),
        expect.objectContaining({ kind: "location", id: "0x1000" }),
      ]),
    );
    expect(result.unknowns[0]?.no_observed_dependency).toBe(false);
    expect(result.projection_id).toMatch(/^ui_[a-f0-9]{64}$/u);
  });

  it("keeps an Unknown with no cited Evidence visible", () => {
    const mutation = fixtureEvidence({ operation: "record_unknown" });
    const unknown = fixtureUnknown(mutation.evidence_id, [], {
      question: "Do we need another capture?",
      probes: 0,
    });
    const result = projectUnknownImpact(fixtureBundle([mutation], [unknown]), {
      unknown_ids: [unknown.unknown_id],
      max_nodes: 8,
    });
    expect(result.unknowns[0]?.no_observed_dependency).toBe(true);
    expect(result.unknowns[0]?.affects).toEqual([]);
    expect(result.unknowns[0]?.recommended_probes).toEqual([]);
  });
});

describe("render_session_chart", () => {
  it("charts retained operation counts with the exact values", () => {
    const first = fixtureEvidence({ operation: "read_bytes" });
    const second = fixtureEvidence({ operation: "read_bytes" });
    const result = renderSessionChart(fixtureBundle([first, second]), {
      source: "evidence_operations",
      format: "svg",
      top: 16,
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.chart.kind).toBe("bar");
    expect(result.value.data.total).toBe(2);
    expect(result.value.data.values).toEqual([
      { label: "read_bytes", value: 2 },
    ]);
    expect(result.value.chart.content).toContain("<title");
  });

  it("fails with an actionable input error when the aggregate is empty", () => {
    const result = renderSessionChart(fixtureBundle([]), {
      source: "unknown_status",
      format: "svg",
      top: 16,
    });
    expect(result.ok).toBe(false);
  });
});

describe("export_investigation_report", () => {
  it("renders a deterministic report citing retained Evidence", () => {
    const { record, bundle } = auditFixture();
    const first = createInvestigationReport(bundle, {
      include_charts: false,
      max_records: 100,
    });
    const second = createInvestigationReport(bundle, {
      include_charts: false,
      max_records: 100,
    });
    expect(first.report_id).toBe(second.report_id);
    expect(first.body).toContain("# Investigation report");
    expect(first.body).toContain("procedure_callers");
    expect(first.body).toContain(record.evidence_id);
    expect(first.cited_evidence_ids).toContain(record.evidence_id);
    expect(first.omissions.records).toBe(0);
  });

  it("states record omissions instead of dropping them silently", () => {
    const first = fixtureEvidence({ operation: "read_bytes" });
    const second = fixtureEvidence({ operation: "search_strings" });
    const report = createInvestigationReport(fixtureBundle([first, second]), {
      include_charts: false,
      max_records: 1,
    });
    expect(report.cited_evidence_ids).toHaveLength(1);
    expect(report.omissions.records).toBe(1);
    expect(report.body).toContain("further retained records are not listed");
  });
});

describe("diagnose_environment", () => {
  it("normalises doctor checks without exposing details or installing", () => {
    const result = projectEnvironmentDiagnosis({
      healthy: false,
      environment_healthy: true,
      checks: [
        { name: "node", ok: true, classification: "healthy" },
        {
          name: "ghidra",
          ok: false,
          classification: "missing_analysis_engine",
          detail: "Ghidra was not found.",
          remediation: "Set REA_GHIDRA_PATH.",
        },
      ],
      providerInspections: [
        {
          id: "ghidra",
          configured: false,
          available: false,
          providerVersion: null,
          checks: [
            {
              name: "ghidra.install",
              ok: false,
              classification: "missing_analysis_engine",
              code: "missing",
              detail: "Ghidra was not found.",
              remediation: "Set REA_GHIDRA_PATH.",
            },
          ],
        },
      ],
    });
    expect(result.summary).toEqual({ available: 1, missing: 1, unknown: 0 });
    expect(result.checks[1]).toMatchObject({
      name: "ghidra",
      status: "missing",
    });
    expect(result.providers[0]?.checks[0]?.status).toBe("missing");
    expect(result.limitations.join(" ")).toContain("never installs");
  });
});
