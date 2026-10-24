import type { BarChartSpec } from "./chartSpec.js";
import {
  CHART_THEME,
  CHART_WIDTH,
  escapeXml,
  fitLabel,
  formatChartNumber,
} from "./chartTheme.js";
import { renderChartHeader } from "./svgFrame.js";

const PADDING = 40;
const LABEL_WIDTH = 300;
const VALUE_WIDTH = 96;
const BAR_HEIGHT = 20;
const ROW_HEIGHT = 46;
const ROW_HEIGHT_WITH_NOTE = 54;
const LABEL_FONT_SIZE = 14;

/** Draw ordered magnitudes as horizontal bars with a single accent highlight. */
export const renderBarChartBody = (
  spec: BarChartSpec,
): {
  readonly body: string;
  readonly width: number;
  readonly height: number;
} => {
  const width = CHART_WIDTH;
  const header = renderChartHeader(
    spec.title,
    spec.description,
    width,
    PADDING,
  );
  const rows = spec.items.map((item, index) => {
    const previous = spec.items
      .slice(0, index)
      .filter((candidate) => candidate.note !== undefined).length;
    return {
      item,
      top:
        header.height +
        index * ROW_HEIGHT +
        previous * (ROW_HEIGHT_WITH_NOTE - ROW_HEIGHT),
    };
  });
  const height =
    (rows.at(-1)?.top ?? header.height) +
    (spec.items.some((item) => item.note !== undefined)
      ? ROW_HEIGHT_WITH_NOTE
      : ROW_HEIGHT) +
    PADDING;
  const plotLeft = PADDING + LABEL_WIDTH;
  const plotWidth = Math.max(120, width - plotLeft - VALUE_WIDTH - PADDING);
  const maximum = Math.max(...spec.items.map((item) => item.value), 1);

  const rowMarkup = rows
    .map(({ item, top }) => {
      const center = top + BAR_HEIGHT / 2;
      const highlighted = spec.highlight === item.label;
      const fill = highlighted ? CHART_THEME.ink : CHART_THEME.accent;
      const barWidth =
        item.value === 0 ? 0 : Math.max(3, (item.value / maximum) * plotWidth);
      const label = fitLabel(item.label, LABEL_WIDTH - 18, LABEL_FONT_SIZE);
      const value = `${formatChartNumber(item.value)}${spec.unit === undefined ? "" : ` ${spec.unit}`}`;
      const valueX = plotLeft + barWidth + 8;
      const noteMarkup =
        item.note === undefined
          ? ""
          : `<text x="${plotLeft + 2}" y="${top + BAR_HEIGHT + 18}" font-family="${CHART_THEME.font}" font-size="12" fill="${CHART_THEME.muted}">${escapeXml(
              fitLabel(item.note, plotWidth, 12),
            )}</text>`;
      return (
        `<text x="${plotLeft - 12}" y="${center + 5}" text-anchor="end" font-family="${CHART_THEME.font}" font-size="${LABEL_FONT_SIZE}" fill="${CHART_THEME.ink}">${escapeXml(label)}</text>` +
        `<rect class="chart-bar" x="${plotLeft}" y="${top}" width="${barWidth.toFixed(1)}" height="${BAR_HEIGHT}" fill="${fill}"/>` +
        `<text x="${valueX}" y="${center + 4}" font-family="${CHART_THEME.mono}" font-size="13" fill="${highlighted ? CHART_THEME.ink : CHART_THEME.muted}">${escapeXml(value)}</text>` +
        noteMarkup
      );
    })
    .join("");

  const baseline = `<rect x="${plotLeft}" y="${header.height - 10}" width="${plotWidth}" height="1" fill="${CHART_THEME.line}"/>`;

  return {
    body: `${header.markup}${baseline}${rowMarkup}`,
    width,
    height,
  };
};
