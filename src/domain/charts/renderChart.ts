import {
  chartSpecSchema,
  type ChartSpec,
  type RenderChartInput,
  type RenderedChart,
} from "./chartSpec.js";
import { CHART_THEME } from "./chartTheme.js";
import { renderBarChartBody } from "./renderBarChart.js";
import { renderCallGraphChartBody } from "./renderCallGraphChart.js";
import { renderLineChartBody } from "./renderLineChart.js";
import { chartDescription, svgDocument } from "./svgFrame.js";

interface ChartBody {
  readonly body: string;
  readonly width: number;
  readonly height: number;
  readonly pointCount: number;
}

const renderBody = (spec: ChartSpec): ChartBody => {
  switch (spec.kind) {
    case "bar": {
      const rendered = renderBarChartBody(spec);
      return { ...rendered, pointCount: spec.items.length };
    }
    case "line": {
      const rendered = renderLineChartBody(spec);
      return { ...rendered, pointCount: spec.labels.length };
    }
    case "call_graph": {
      const rendered = renderCallGraphChartBody(spec);
      return { ...rendered, pointCount: spec.nodes.length };
    }
  }
};

/** Standalone HTML page so a rendered chart opens, prints and embeds directly. */
export const chartHtmlDocument = (svg: string): string =>
  `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1">\n<title>REA chart</title>\n<style>\n  :root { color-scheme: light; background: ${CHART_THEME.page}; }\n  body { margin: 0; padding: 32px; background: ${CHART_THEME.page}; }\n  figure { margin: 0 auto; max-width: 1120px; }\n  svg { display: block; width: 100%; height: auto; }\n  @media print { body { padding: 0; } }\n</style>\n</head>\n<body>\n<figure>${svg}</figure>\n</body>\n</html>\n`;

/** Validate and render one chart, returning markup and its measured canvas. */
export const renderChart = (input: RenderChartInput): RenderedChart => {
  const spec = chartSpecSchema.parse(input.chart);
  const rendered = renderBody(spec);
  const description = chartDescription(
    spec.kind,
    rendered.pointCount,
    spec.description,
  );
  const svg = svgDocument({
    width: rendered.width,
    height: rendered.height,
    title: spec.title,
    description,
    body: rendered.body,
  });
  return {
    kind: spec.kind,
    format: input.format,
    width: rendered.width,
    height: rendered.height,
    title: spec.title,
    content: input.format === "html" ? chartHtmlDocument(svg) : svg,
  };
};
