import type { CallGraphChartSpec } from "./chartSpec.js";
import {
  CHART_THEME,
  CHART_WIDTH,
  escapeXml,
  fitLabel,
  stableChartId,
} from "./chartTheme.js";
import { renderChartHeader } from "./svgFrame.js";

const PADDING = 40;
const NODE_WIDTH = 210;
const NODE_HEIGHT = 42;
const GAP_Y = 18;
const GAP_X = 96;
const NODE_STROKE = "#c3ccd4";
const MAX_DEPTH = 12;

interface Placement {
  readonly x: number;
  readonly y: number;
}

type GraphEdge = CallGraphChartSpec["edges"][number];
type GraphNode = CallGraphChartSpec["nodes"][number];

/**
 * Layered left-to-right placement. Explicit depths win; otherwise roots start
 * at the leftmost column and each callee moves one column right. Nodes left
 * over inside a cycle join depth 0 instead of being dropped.
 */
const explicitDepths = (nodes: readonly GraphNode[]): Map<string, number> => {
  const depths = new Map<string, number>();
  for (const node of nodes)
    if (node.depth !== undefined) depths.set(node.id, node.depth);
  return depths;
};

const indexCalls = (
  nodes: readonly GraphNode[],
  edges: readonly GraphEdge[],
): { outgoing: Map<string, string[]>; incoming: Map<string, number> } => {
  const outgoing = new Map<string, string[]>();
  const incoming = new Map<string, number>();
  for (const node of nodes) {
    outgoing.set(node.id, []);
    incoming.set(node.id, 0);
  }
  for (const edge of edges) {
    outgoing.get(edge.source)?.push(edge.target);
    incoming.set(edge.target, (incoming.get(edge.target) ?? 0) + 1);
  }
  return { outgoing, incoming };
};

const assignDepths = (
  spec: CallGraphChartSpec,
): ReadonlyMap<string, number> => {
  const depths = explicitDepths(spec.nodes);
  if (depths.size === spec.nodes.length) return depths;
  const { outgoing, incoming } = indexCalls(spec.nodes, spec.edges);
  const roots = spec.nodes
    .filter((node) => (incoming.get(node.id) ?? 0) === 0)
    .map((node) => node.id);
  const queue = roots.length > 0 ? roots : [spec.nodes[0]?.id ?? ""];
  for (const root of queue)
    if (root.length > 0 && !depths.has(root)) depths.set(root, 0);
  for (let index = 0; index < queue.length; index += 1) {
    const current = queue[index];
    if (current === undefined) continue;
    const depth = depths.get(current) ?? 0;
    for (const target of outgoing.get(current) ?? []) {
      if (depths.has(target)) continue;
      depths.set(target, Math.min(depth + 1, MAX_DEPTH));
      queue.push(target);
    }
  }
  for (const node of spec.nodes)
    if (!depths.has(node.id)) depths.set(node.id, 0);
  return depths;
};

/** Group node ids into depth columns, preserving the declared order. */
const columnGroups = (
  spec: CallGraphChartSpec,
  depths: ReadonlyMap<string, number>,
): string[][] => {
  const columns: string[][] = [];
  for (const node of spec.nodes) {
    const depth = Math.min(depths.get(node.id) ?? 0, MAX_DEPTH);
    while (columns.length <= depth) columns.push([]);
    columns[depth]?.push(node.id);
  }
  for (const column of columns) column.sort();
  return columns;
};

/** Place every column, centering short columns against the tallest one. */
const placeColumns = (
  columns: readonly string[][],
  gap: number,
  graphTop: number,
  rowCount: number,
): ReadonlyMap<string, Placement> => {
  const placements = new Map<string, Placement>();
  const graphHeight = rowCount * NODE_HEIGHT + (rowCount - 1) * GAP_Y;
  for (const [columnIndex, column] of columns.entries()) {
    const columnHeight =
      column.length * NODE_HEIGHT + Math.max(0, column.length - 1) * GAP_Y;
    const centeredTop =
      graphTop + Math.max(0, (graphHeight - columnHeight) / 2);
    for (const [rowIndex, id] of column.entries())
      placements.set(id, {
        x: PADDING + columnIndex * (NODE_WIDTH + gap),
        y: centeredTop + rowIndex * (NODE_HEIGHT + GAP_Y),
      });
  }
  return placements;
};

const edgeMarkup = (
  edge: GraphEdge,
  placements: ReadonlyMap<string, Placement>,
  arrowId: string,
): string => {
  const source = placements.get(edge.source);
  const target = placements.get(edge.target);
  if (source === undefined || target === undefined) return "";
  const startX = source.x + NODE_WIDTH;
  const startY = source.y + NODE_HEIGHT / 2;
  const endX = target.x;
  const endY = target.y + NODE_HEIGHT / 2;
  const backward = endX <= startX;
  const bend = backward
    ? Math.max(28, Math.abs(startX - endX) / 2)
    : Math.max(24, (endX - startX) / 2);
  const path =
    `M ${startX} ${startY} ` +
    `C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`;
  const style = backward ? 'stroke-dasharray="4 3" ' : "";
  return `<path d="${path}" fill="none" stroke="${CHART_THEME.muted}" stroke-opacity="${backward ? "0.45" : "0.65"}" stroke-width="1.25" ${style}marker-end="url(#${arrowId})"/>`;
};

const nodeMarkup = (
  node: GraphNode,
  placement: Placement | undefined,
  highlighted: boolean,
): string => {
  if (placement === undefined) return "";
  return (
    `<rect class="chart-node" x="${placement.x.toFixed(1)}" y="${placement.y.toFixed(1)}" width="${NODE_WIDTH}" height="${NODE_HEIGHT}" rx="3" fill="${highlighted ? CHART_THEME.soft : CHART_THEME.page}" stroke="${highlighted ? CHART_THEME.accent : NODE_STROKE}" stroke-width="${highlighted ? "1.75" : "1"}"/>` +
    `<text x="${(placement.x + 12).toFixed(1)}" y="${(placement.y + 26).toFixed(1)}" font-family="${CHART_THEME.font}" font-size="13" fill="${CHART_THEME.ink}">${escapeXml(
      fitLabel(node.label, NODE_WIDTH - 24, 13),
    )}</text>`
  );
};

/** Draw functions as boxes in call-depth columns, joined by directed edges. */
export const renderCallGraphChartBody = (
  spec: CallGraphChartSpec,
): {
  readonly body: string;
  readonly width: number;
  readonly height: number;
} => {
  const columns = columnGroups(spec, assignDepths(spec));
  const columnCount = columns.length;
  const rowCount = Math.max(...columns.map((column) => column.length), 1);
  const naturalWidth =
    PADDING * 2 + columnCount * NODE_WIDTH + (columnCount - 1) * GAP_X;
  const width = Math.max(CHART_WIDTH, naturalWidth);
  const available = width - PADDING * 2 - columnCount * NODE_WIDTH;
  const gap =
    columnCount <= 1
      ? 0
      : Math.max(64, Math.min(200, available / (columnCount - 1)));
  const header = renderChartHeader(
    spec.title,
    spec.description,
    width,
    PADDING,
  );
  const arrowId = `chart-arrow-${stableChartId(spec.title)}`;
  const height =
    header.height +
    rowCount * NODE_HEIGHT +
    Math.max(0, rowCount - 1) * GAP_Y +
    PADDING;
  const placements = placeColumns(columns, gap, header.height, rowCount);
  const edges = spec.edges
    .map((edge) => edgeMarkup(edge, placements, arrowId))
    .join("");
  const nodes = spec.nodes
    .map((node) =>
      nodeMarkup(node, placements.get(node.id), spec.highlight === node.id),
    )
    .join("");
  return {
    body:
      `<defs><marker id="${arrowId}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" fill="${CHART_THEME.muted}"/></marker></defs>` +
      `${header.markup}${edges}${nodes}`,
    width,
    height,
  };
};
