import { z } from "zod";

const label = z.string().trim().min(1).max(120);
const description = z.string().trim().min(1).max(400);
const title = z.string().trim().min(1).max(160);
const magnitude = z.number().finite().min(0);
const note = z.string().trim().min(1).max(80);

const barChartSpecSchema = z
  .strictObject({
    kind: z.literal("bar"),
    title,
    description: description.optional(),
    unit: z.string().trim().min(1).max(24).optional(),
    items: z
      .array(
        z
          .strictObject({
            label,
            value: magnitude,
            note: note.optional(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    highlight: label.optional(),
  })
  .superRefine((spec, context) => {
    if (
      spec.highlight !== undefined &&
      !spec.items.some((item) => item.label === spec.highlight)
    )
      context.addIssue({
        code: "custom",
        path: ["highlight"],
        message: "highlight must name an item label",
      });
    if (
      new Set(spec.items.map((item) => item.label)).size !== spec.items.length
    )
      context.addIssue({
        code: "custom",
        path: ["items"],
        message: "Bar labels must be unique so highlight can select one",
      });
  });

const lineSeriesSchema = z
  .strictObject({
    label,
    values: z.array(magnitude).min(1).max(64),
  })
  .strict();

const lineChartSpecSchema = z
  .strictObject({
    kind: z.literal("line"),
    title,
    description: description.optional(),
    unit: z.string().trim().min(1).max(24).optional(),
    labels: z.array(label).min(1).max(64),
    series: z.array(lineSeriesSchema).min(1).max(4),
    highlight: label.optional(),
  })
  .superRefine((spec, context) => {
    for (const [index, series] of spec.series.entries())
      if (series.values.length !== spec.labels.length)
        context.addIssue({
          code: "custom",
          path: ["series", index, "values"],
          message: "Every series needs one value per x-axis label",
        });
    const seriesLabels = spec.series.map((series) => series.label);
    if (new Set(seriesLabels).size !== seriesLabels.length)
      context.addIssue({
        code: "custom",
        path: ["series"],
        message: "Series labels must be unique",
      });
    if (spec.highlight !== undefined && !seriesLabels.includes(spec.highlight))
      context.addIssue({
        code: "custom",
        path: ["highlight"],
        message: "highlight must name a series label",
      });
  });

const graphNodeSchema = z
  .strictObject({
    id: z.string().trim().min(1).max(64),
    label,
    depth: z.int().min(0).max(32).optional(),
  })
  .strict();

const graphEdgeSchema = z
  .strictObject({
    source: z.string().trim().min(1).max(64),
    target: z.string().trim().min(1).max(64),
  })
  .strict();

const callGraphChartSpecSchema = z
  .strictObject({
    kind: z.literal("call_graph"),
    title,
    description: description.optional(),
    nodes: z.array(graphNodeSchema).min(1).max(128),
    edges: z.array(graphEdgeSchema).max(512),
    highlight: z.string().trim().min(1).max(64).optional(),
  })
  .superRefine((spec, context) => {
    const ids = new Set(spec.nodes.map((node) => node.id));
    if (ids.size !== spec.nodes.length)
      context.addIssue({
        code: "custom",
        path: ["nodes"],
        message: "Node ids must be unique",
      });
    for (const [index, edge] of spec.edges.entries()) {
      if (!ids.has(edge.source) || !ids.has(edge.target))
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "Every edge endpoint must name a declared node id",
        });
      if (edge.source === edge.target)
        context.addIssue({
          code: "custom",
          path: ["edges", index],
          message: "Self edges are not charted",
        });
    }
    if (spec.highlight !== undefined && !ids.has(spec.highlight))
      context.addIssue({
        code: "custom",
        path: ["highlight"],
        message: "highlight must name a node id",
      });
  });

/** One editorial chart: ordered categories, numeric series or a call graph. */
export const chartSpecSchema = z.discriminatedUnion("kind", [
  barChartSpecSchema,
  lineChartSpecSchema,
  callGraphChartSpecSchema,
]);

export type BarChartSpec = z.infer<typeof barChartSpecSchema>;
export type LineChartSpec = z.infer<typeof lineChartSpecSchema>;
export type CallGraphChartSpec = z.infer<typeof callGraphChartSpecSchema>;
export type ChartSpec = z.infer<typeof chartSpecSchema>;

/** Render one chart as self-contained SVG, or inside a standalone HTML page. */
export const renderChartInputSchema = z
  .strictObject({
    chart: chartSpecSchema,
    format: z.enum(["svg", "html"]).default("svg"),
  })
  .strict();

export type RenderChartInput = z.infer<typeof renderChartInputSchema>;

/** Size and identity of one rendered chart, without repeating its markup. */
export const renderedChartSchema = z
  .strictObject({
    kind: z.enum(["bar", "line", "call_graph"]),
    format: z.enum(["svg", "html"]),
    width: z.int().positive(),
    height: z.int().positive(),
    title: z.string().min(1),
    content: z.string().min(1),
  })
  .strict();

export type RenderedChart = z.infer<typeof renderedChartSchema>;
