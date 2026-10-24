import { z } from "zod";

import { AnalysisInputError } from "./analysisErrorCore.js";
import { renderedChartSchema } from "./charts/chartSpec.js";
import { renderChart } from "./charts/renderChart.js";
import type { EvidenceBundle } from "./evidenceBundle.js";
import { prefixedDigestSchema } from "./digests.js";
import { err, ok, type Result } from "./result.js";

/** Caller-selected aggregate and presentation format. */
export const sessionChartInputSchema = z.strictObject({
  source: z
    .enum([
      "evidence_operations",
      "unknown_status",
      "evidence_confidence",
      "relationship_coverage",
    ])
    .default("evidence_operations")
    .describe(
      "Which retained-session aggregate to chart; the data table is returned with the chart",
    ),
  format: z.enum(["svg", "html"]).default("svg"),
  top: z.int().min(1).max(32).default(16),
  title: z.string().trim().min(1).max(160).optional(),
});

export type SessionChartInput = z.output<typeof sessionChartInputSchema>;

/** A rendered aggregate chart plus the exact counts it presents. */
export const sessionChartResultSchema = z.strictObject({
  chart: renderedChartSchema,
  data: z.strictObject({
    source: z.enum([
      "evidence_operations",
      "unknown_status",
      "evidence_confidence",
      "relationship_coverage",
    ]),
    total: z.int().min(0),
    categories: z.int().min(0),
    omitted: z.int().min(0),
    unit: z.string().min(1),
    values: z.array(
      z.strictObject({ label: z.string().min(1), value: z.int().min(0) }),
    ),
  }),
  evidence_ids: z.array(prefixedDigestSchema("ev")),
  evidence_ids_truncated: z.boolean(),
  limitations: z.array(z.string()),
});

export type SessionChartResult = z.output<typeof sessionChartResultSchema>;

const countBy = (
  values: readonly string[],
): ReadonlyArray<{ label: string; value: number }> => {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts]
    .map(([label, value]) => ({ label, value }))
    .sort((left, right) =>
      right.value === left.value
        ? left.label < right.label
          ? -1
          : 1
        : right.value - left.value,
    );
};

/**
 * Chart retained session aggregates. The chart is presentation: the returned
 * values and contributing evidence identifiers keep every number auditable.
 */
export const renderSessionChart = (
  bundle: EvidenceBundle,
  input: SessionChartInput,
): Result<SessionChartResult, AnalysisInputError> => {
  let values: ReadonlyArray<{ label: string; value: number }>;
  let unit: string;
  let description: string;
  switch (input.source) {
    case "evidence_operations":
      values = countBy(bundle.records.map((record) => record.operation));
      unit = "records";
      description =
        "Retained Evidence records per observed operation. Counts describe this session's records, not target behavior.";
      break;
    case "unknown_status":
      values = countBy(bundle.unknowns.map((unknown) => unknown.status));
      unit = "unknowns";
      description =
        "Residual unknowns per recorded status. A resolved unknown remains counted in the session.";
      break;
    case "evidence_confidence":
      values = countBy(bundle.records.map((record) => record.confidence));
      unit = "records";
      description =
        "Retained Evidence records per confidence class. Inferred records are not observations.";
      break;
    case "relationship_coverage":
      values = countBy(
        bundle.records.map(
          (record) => record.relationship_coverage?.status ?? "absent",
        ),
      );
      unit = "records";
      description =
        "Retained records per relationship-coverage state. Absent means the provider reported no coverage for that record.";
      break;
  }
  if (values.length === 0)
    return err(
      new AnalysisInputError(
        "render_session_chart",
        {
          userMessage:
            "The session has no retained data for the requested aggregate. Open a target and record observations, or choose another source.",
        },
        [
          {
            path: ["source"],
            reason: "invalid_value",
            message: "no retained data",
          },
        ],
      ),
    );
  const included = values.slice(0, input.top);
  const total = values.reduce((sum, entry) => sum + entry.value, 0);
  const chart = renderChart({
    chart: {
      kind: "bar",
      title: input.title ?? "Retained session evidence",
      description,
      unit,
      items: included,
    },
    format: input.format,
  });
  const evidenceIds = bundle.records.map((record) => record.evidence_id).sort();
  return ok(
    sessionChartResultSchema.parse({
      chart,
      data: {
        source: input.source,
        total,
        categories: values.length,
        omitted: values.length - included.length,
        unit,
        values: included,
      },
      evidence_ids: evidenceIds.slice(0, 200),
      evidence_ids_truncated: evidenceIds.length > 200,
      limitations: [
        "The chart is presentation only: it records no Evidence and adds no observations.",
        ...(values.length > included.length
          ? [
              `Only the ${String(included.length)} largest categories are charted; data.omitted reports the rest.`,
            ]
          : []),
      ],
    }),
  );
};
