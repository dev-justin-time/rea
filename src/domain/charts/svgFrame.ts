import { CHART_THEME, CHART_WIDTH, escapeXml, wrapText } from "./chartTheme.js";

/** Rendered title block shared by every chart kind. */
export interface ChartHeader {
  readonly markup: string;
  readonly height: number;
}

/** Title and optional one-sentence reading aid, drawn as real text elements. */
export const renderChartHeader = (
  title: string,
  description: string | undefined,
  width: number = CHART_WIDTH,
  padding = 40,
): ChartHeader => {
  const usable = width - padding * 2;
  const maxCharacters = Math.max(24, Math.floor(usable / 8.2));
  const lines =
    description === undefined
      ? []
      : wrapText(description, maxCharacters, 2).map(escapeXml);
  const titleMarkup = `<text x="${padding}" y="${padding + 18}" font-family="${CHART_THEME.font}" font-size="26" font-weight="600" fill="${CHART_THEME.ink}">${escapeXml(title)}</text>`;
  const lineMarkup = lines
    .map(
      (line, index) =>
        `<text x="${padding}" y="${padding + 50 + index * 21}" font-family="${CHART_THEME.font}" font-size="15" fill="${CHART_THEME.muted}">${line}</text>`,
    )
    .join("");
  return {
    markup: `${titleMarkup}${lineMarkup}`,
    height:
      padding + 18 + (lines.length === 0 ? 0 : 8 + lines.length * 21) + 26,
  };
};

/** Wrap chart body markup in an accessible, self-contained SVG document. */
export const svgDocument = (input: {
  readonly width: number;
  readonly height: number;
  readonly title: string;
  readonly description: string;
  readonly body: string;
}): string =>
  `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${input.width} ${input.height}" width="${input.width}" height="${input.height}" role="img" aria-labelledby="chart-title chart-desc">` +
  `<title id="chart-title">${escapeXml(input.title)}</title>` +
  `<desc id="chart-desc">${escapeXml(input.description)}</desc>` +
  `<rect width="${input.width}" height="${input.height}" fill="${CHART_THEME.page}"/>` +
  input.body +
  `</svg>`;

/** A short, factual fallback description when the caller supplied none. */
export const chartDescription = (
  kind: "bar" | "line" | "call_graph",
  pointCount: number,
  detail?: string,
): string => {
  if (detail !== undefined && detail.trim().length > 0) return detail.trim();
  if (kind === "call_graph")
    return `Directed call graph with ${pointCount} ${pointCount === 1 ? "function" : "functions"}.`;
  return `Chart with ${pointCount} plotted ${pointCount === 1 ? "value" : "values"}.`;
};
