import type { LineChartSpec } from "./chartSpec.js";
import {
  CHART_THEME,
  CHART_WIDTH,
  escapeXml,
  fitLabel,
  formatChartNumber,
} from "./chartTheme.js";
import { renderChartHeader } from "./svgFrame.js";

const PADDING = 40;
const PLOT_HEIGHT = 300;
const AXIS_WIDTH = 64;
const LEGEND_HEIGHT = 28;
const TICK_COUNT = 4;

const niceCeiling = (maximum: number): number => {
  if (maximum <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(maximum));
  const normalized = maximum / magnitude;
  const step =
    normalized <= 1 ? 1 : normalized <= 2 ? 2 : normalized <= 5 ? 5 : 10;
  return step * magnitude;
};

const renderLegend = (spec: LineChartSpec, top: number): string =>
  spec.series
    .map((series, index) => {
      const x =
        PADDING +
        spec.series
          .slice(0, index)
          .reduce(
            (total, earlier) =>
              total + fitLabel(earlier.label, 180, 13).length * 7.3 + 42,
            0,
          );
      const color =
        spec.highlight === series.label
          ? CHART_THEME.ink
          : CHART_THEME.series[index % CHART_THEME.series.length];
      return (
        `<rect x="${x.toFixed(1)}" y="${top + 4}" width="10" height="10" fill="${color}"/>` +
        `<text x="${(x + 16).toFixed(1)}" y="${top + 13}" font-family="${CHART_THEME.font}" font-size="13" fill="${CHART_THEME.muted}">${escapeXml(fitLabel(series.label, 180, 13))}</text>`
      );
    })
    .join("");

/** Draw one line per series over shared, evenly spaced x-axis labels. */
export const renderLineChartBody = (
  spec: LineChartSpec,
): {
  readonly body: string;
  readonly width: number;
  readonly height: number;
} => {
  const width = CHART_WIDTH;
  const hasLegend = spec.series.length > 1;
  const header = renderChartHeader(
    spec.title,
    spec.description,
    width,
    PADDING,
  );
  const legendTop = header.height;
  const plotTop = legendTop + (hasLegend ? LEGEND_HEIGHT : 6);
  const plotBottom = plotTop + PLOT_HEIGHT;
  const plotLeft = PADDING + AXIS_WIDTH;
  const plotRight = width - PADDING - 12;
  const plotWidth = plotRight - plotLeft;
  const height = plotBottom + 58;
  const values = spec.series.flatMap((series) => series.values);
  const maximum = niceCeiling(Math.max(...values, 0) * 1.08);
  const tickValue = maximum / TICK_COUNT;
  const xFor = (index: number): number =>
    spec.labels.length === 1
      ? plotLeft + plotWidth / 2
      : plotLeft + (index / (spec.labels.length - 1)) * plotWidth;
  const yFor = (value: number): number =>
    plotBottom - (value / maximum) * PLOT_HEIGHT;

  const gridMarkup = Array.from({ length: TICK_COUNT + 1 }, (_, index) => {
    const value = tickValue * index;
    const y = yFor(value);
    return (
      `<rect x="${plotLeft}" y="${y.toFixed(1)}" width="${plotWidth}" height="1" fill="${CHART_THEME.line}"/>` +
      `<text x="${plotLeft - 10}" y="${(y + 4).toFixed(1)}" text-anchor="end" font-family="${CHART_THEME.mono}" font-size="12" fill="${CHART_THEME.muted}">${escapeXml(formatChartNumber(value))}</text>`
    );
  }).join("");

  const labelStep = Math.max(1, Math.ceil(spec.labels.length / 8));
  const xLabels = spec.labels
    .map((label, index) => {
      const isLast = index === spec.labels.length - 1;
      if (index % labelStep !== 0 && !isLast) return "";
      const slot = plotWidth / Math.max(1, spec.labels.length - 1);
      return `<text x="${xFor(index).toFixed(1)}" y="${plotBottom + 24}" text-anchor="middle" font-family="${CHART_THEME.font}" font-size="12" fill="${CHART_THEME.muted}">${escapeXml(
        fitLabel(label, Math.max(64, slot - 8), 12),
      )}</text>`;
    })
    .join("");

  const seriesMarkup = spec.series
    .map((series, index) => {
      const highlighted = spec.highlight === series.label;
      const color = highlighted
        ? CHART_THEME.ink
        : CHART_THEME.series[index % CHART_THEME.series.length];
      const points = series.values
        .map(
          (value, valueIndex) =>
            `${xFor(valueIndex).toFixed(1)},${yFor(value).toFixed(1)}`,
        )
        .join(" ");
      const showPoints = spec.labels.length <= 16;
      const dots = showPoints
        ? series.values
            .map(
              (value, valueIndex) =>
                `<circle class="chart-dot" cx="${xFor(valueIndex).toFixed(1)}" cy="${yFor(value).toFixed(1)}" r="${highlighted ? 3.5 : 3}" fill="${color}" stroke="${CHART_THEME.page}" stroke-width="1"/>`,
            )
            .join("")
        : "";
      return `<polyline class="chart-line" points="${points}" fill="none" stroke="${color}" stroke-width="${highlighted ? 3 : 2.25}" stroke-linecap="round" stroke-linejoin="round"/>${dots}`;
    })
    .join("");

  const legendMarkup = hasLegend ? renderLegend(spec, legendTop) : "";

  const unitMarkup =
    spec.unit === undefined
      ? ""
      : `<text x="${plotLeft}" y="${plotTop - 8}" font-family="${CHART_THEME.mono}" font-size="11" fill="${CHART_THEME.muted}">${escapeXml(spec.unit)}</text>`;

  return {
    body: `${header.markup}${legendMarkup}${unitMarkup}${gridMarkup}${seriesMarkup}${xLabels}`,
    width,
    height,
  };
};
