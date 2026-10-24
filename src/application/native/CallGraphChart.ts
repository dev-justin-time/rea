import type { JsonValue } from "../../domain/jsonValue.js";
import type { RenderedChart } from "../../domain/charts/chartSpec.js";
import { renderChart } from "../../domain/charts/renderChart.js";

const MAX_CHART_NODES = 128;
const MAX_CHART_EDGES = 512;

const isRecord = (value: JsonValue): value is Record<string, JsonValue> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * Project the provider-composed depth groups into one layered chart. The chart
 * is a view of observed relationships only; nodes and calls beyond the chart's
 * caps are reported as a limitation rather than silently implied to be absent.
 */
export const callGraphChart = (
  graph: Readonly<Record<string, readonly JsonValue[]>>,
  startAddress: string,
  format: "svg" | "html",
): {
  readonly chart: RenderedChart;
  readonly limitations: readonly string[];
} => {
  const nodes: Array<{ id: string; label: string; depth: number }> = [];
  const edges: Array<{ source: string; target: string }> = [];
  for (const [level, rows] of Object.entries(graph)) {
    const depth = Number(level);
    if (!Number.isInteger(depth) || depth < 0) continue;
    for (const row of rows) {
      if (!isRecord(row)) continue;
      const address = row.address;
      if (typeof address !== "string" || address.length === 0) continue;
      nodes.push({ id: address, label: address, depth: Math.min(depth, 32) });
      const calls = row.calls;
      if (!Array.isArray(calls)) continue;
      for (const target of calls)
        if (typeof target === "string" && target.length > 0)
          edges.push({ source: address, target });
    }
  }

  const chartNodes = nodes.slice(0, MAX_CHART_NODES);
  const retained = new Set(chartNodes.map((node) => node.id));
  const chartEdges = edges
    .filter((edge) => retained.has(edge.source) && retained.has(edge.target))
    .slice(0, MAX_CHART_EDGES);
  const droppedNodes = nodes.length - chartNodes.length;
  const droppedEdges = edges.length - chartEdges.length;
  const limitations =
    droppedNodes === 0 && droppedEdges === 0
      ? []
      : [
          `The chart shows ${chartNodes.length} of ${nodes.length} observed functions and ${chartEdges.length} of ${edges.length} observed calls; the graph above remains complete.`,
        ];

  const chart = renderChart({
    chart: {
      kind: "call_graph",
      title: `Call graph from ${startAddress}`,
      description:
        "Depth columns follow the requested traversal direction; dashed edges return to an earlier column.",
      nodes: chartNodes,
      edges: chartEdges,
      ...(retained.has(startAddress) ? { highlight: startAddress } : {}),
    },
    format,
  });
  return { chart, limitations };
};
