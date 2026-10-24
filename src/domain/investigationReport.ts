import { z } from "zod";

import { digestCanonicalValue } from "./canonicalDigest.js";
import { uniqueSorted } from "./canonicalOrdering.js";
import { auditEvidenceCoverage } from "./evidenceCoverageAudit.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { prefixedDigestSchema } from "./digests.js";
import { renderSessionChart } from "./sessionChart.js";

/** Caller-selected report detail. */
export const investigationReportInputSchema = z.strictObject({
  include_charts: z.boolean().default(false),
  max_records: z.int().min(1).max(2000).default(500),
});

export type InvestigationReportInput = z.output<
  typeof investigationReportInputSchema
>;

/** A deterministic Markdown dossier over retained Evidence. */
export const investigationReportResultSchema = z.strictObject({
  report_id: prefixedDigestSchema("ir"),
  format: z.literal("markdown"),
  body: z.string().min(1),
  sections: z.array(z.string().min(1)),
  cited_evidence_ids: z.array(prefixedDigestSchema("ev")),
  omissions: z.strictObject({
    records: z.int().min(0),
    charts: z.int().min(0),
  }),
  limitations: z.array(z.string()),
});

export type InvestigationReportResult = z.output<
  typeof investigationReportResultSchema
>;

/** Escape caller-influenced text for inline Markdown prose and tables. */
const text = (value: string): string =>
  value.replace(/[\\`*_{}[\]()<>|#+~-]/gu, "\\$&");

const code = (value: string): string =>
  `\`${value.replaceAll("`", "'").replaceAll("\n", " ")}\``;

const coverageCell = (
  entry: ReturnType<typeof auditEvidenceCoverage>["operations"][number],
): string =>
  `${String(entry.coverage.complete)}/${String(entry.coverage.partial)}/${String(entry.coverage.unknown)}/${String(entry.coverage.absent)}`;

/**
 * Render one report from retained state. The body is a projection: it cites
 * Evidence identifiers instead of restating unverified claims, and the digest
 * covers the rendered body so two identical inputs produce the same report.
 */
export const createInvestigationReport = (
  bundle: EvidenceBundle,
  input: InvestigationReportInput,
): InvestigationReportResult => {
  const audit = auditEvidenceCoverage(bundle, {
    focus: "all",
    include_remediation: true,
  });
  const targets = new Map<
    string,
    { name: string; format: string; architecture: string | null }
  >();
  const providers = new Map<string, { name: string; version: string | null }>();
  for (const record of bundle.records) {
    if (record.subject !== null)
      targets.set(record.subject.digest.sha256, {
        name: record.subject.name,
        format: record.subject.format,
        architecture: record.subject.architecture,
      });
    providers.set(record.provider.id, {
      name: record.provider.name,
      version: record.provider.version,
    });
  }
  const evidenceIds = uniqueSorted(
    bundle.records.map((record) => record.evidence_id),
  );
  const cited = evidenceIds.slice(0, input.max_records);
  const sections = [
    "Scope",
    "Evidence inventory",
    "Coverage gaps",
    "Unresolved unknowns",
    "Citations",
    "Limitations",
  ];
  const lines: string[] = [
    "# Investigation report",
    "",
    "> Derived from retained Evidence only. This report records no observations and adds no Evidence.",
    "",
    "## Scope",
    "",
    `- Retained Evidence records: ${String(bundle.records.length)}`,
    `- Residual unknowns: ${String(bundle.unknowns.length)}`,
    `- Coverage audit: ${code(audit.audit_id)}`,
    "",
  ];
  if (targets.size > 0) {
    lines.push(
      "| Target | Format | Architecture | SHA-256 |",
      "| --- | --- | --- | --- |",
    );
    for (const [sha256, target] of [...targets].sort(([left], [right]) =>
      left < right ? -1 : 1,
    ))
      lines.push(
        `| ${text(target.name)} | ${text(target.format)} | ${text(target.architecture ?? "unknown")} | ${code(sha256)} |`,
      );
    lines.push("");
  } else lines.push("No target subject was retained.", "");
  lines.push(
    `Providers: ${
      [...providers]
        .sort(([left], [right]) => (left < right ? -1 : 1))
        .map(
          ([id, provider]) =>
            `${text(provider.name)} ${text(provider.version ?? "version unknown")} (${code(id)})`,
        )
        .join(", ") || "none"
    }.`,
    "",
    "## Evidence inventory",
    "",
    "| Operation | Records | Observed | Derived | Inferred | Coverage complete/partial/unknown/absent |",
    "| --- | --- | --- | --- | --- | --- |",
  );
  for (const entry of audit.operations)
    lines.push(
      `| ${text(entry.operation)} | ${String(entry.records)} | ${String(entry.observed)} | ${String(entry.derived)} | ${String(entry.inferred)} | ${coverageCell(entry)} |`,
    );
  if (audit.operations.length === 0)
    lines.push("| none | 0 | 0 | 0 | 0 | 0/0/0/0 |");
  lines.push("", "## Coverage gaps", "");
  if (audit.gaps.length === 0) lines.push("No retained gap was found.");
  else
    for (const gap of audit.gaps)
      lines.push(
        `- ${text(gap.kind)} affecting ${gap.affects.map((affect) => code(affect)).join(", ")}${
          gap.evidence_ids.length === 0
            ? ""
            : ` — ${gap.evidence_ids.map((id) => code(id)).join(", ")}`
        }${gap.closing_observation === null ? "" : ` — ${text(gap.closing_observation)}`}`,
      );
  lines.push("", "## Unresolved unknowns", "");
  const unresolved = bundle.unknowns
    .filter((unknown) => unknown.status !== "resolved")
    .sort((left, right) => (left.unknown_id < right.unknown_id ? -1 : 1));
  if (unresolved.length === 0) lines.push("No unresolved Unknown is retained.");
  else
    for (const unknown of unresolved)
      lines.push(
        `- ${code(unknown.unknown_id)} — ${text(unknown.question)} (${text(unknown.status)}, ${text(unknown.severity)}, ${text(unknown.domain)})${
          unknown.recommended_probes.length === 0
            ? ""
            : ` — next probe: ${text(unknown.recommended_probes[0]!.operation)}`
        }`,
      );
  lines.push("", "## Citations", "");
  for (const evidenceId of cited) {
    const record = bundle.records.find(
      (candidate) => candidate.evidence_id === evidenceId,
    );
    lines.push(
      `- ${code(evidenceId)} — ${text(record?.operation ?? "operation unavailable")}`,
    );
  }
  if (evidenceIds.length > cited.length)
    lines.push(
      "",
      `${String(evidenceIds.length - cited.length)} further retained records are not listed. Export the Evidence bundle for the complete set.`,
    );
  lines.push("", "## Limitations", "");
  for (const limitation of [
    ...audit.limitations,
    "The report preserves retained uncertainty; a gap or unmatched observation is not evidence of absence.",
  ])
    lines.push(`- ${text(limitation)}`);
  let charts = 0;
  let chartOmitted = 0;
  if (input.include_charts && bundle.records.length > 0) {
    const rendered = renderSessionChart(bundle, {
      source: "evidence_operations",
      format: "svg",
      top: 16,
    });
    if (rendered.ok) {
      lines.push("", "## Evidence chart", "", rendered.value.chart.content);
      charts = 1;
      chartOmitted = rendered.value.data.omitted;
    } else chartOmitted = 1;
  }
  const body = `${lines.join("\n")}\n`;
  return investigationReportResultSchema.parse({
    report_id: `ir_${digestCanonicalValue({ body }, "Investigation report")}`,
    format: "markdown",
    body,
    sections,
    cited_evidence_ids: cited,
    omissions: {
      records: evidenceIds.length - cited.length,
      charts: chartOmitted,
    },
    limitations: [
      "The report is presentation only and records no Evidence.",
      "No observation timestamp is rendered because retained Evidence carries none; ordering follows explicit identifiers.",
      ...(charts === 0 && input.include_charts
        ? [
            "No chart was embedded because the requested aggregate was unavailable.",
          ]
        : []),
    ],
  });
};
