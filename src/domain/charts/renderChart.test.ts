import { describe, expect, it } from "vitest";

import { chartSpecSchema } from "./chartSpec.js";
import { formatChartNumber } from "./chartTheme.js";
import { chartHtmlDocument, renderChart } from "./renderChart.js";

const bar = {
  kind: "bar" as const,
  title: "Observed callers",
  description: "Direct callers of the sound-pan helper.",
  unit: "calls",
  items: [
    { label: "brick_hit", value: 1234.5, note: "tile collision path" },
    { label: "menu_draw", value: 0 },
  ],
  highlight: "brick_hit",
};

describe("chart specification", () => {
  it("rejects a highlight that names no data point", () => {
    const parsed = chartSpecSchema.safeParse({ ...bar, highlight: "missing" });
    expect(parsed.success).toBe(false);
  });

  it("rejects duplicate bar labels", () => {
    const parsed = chartSpecSchema.safeParse({
      ...bar,
      items: [
        { label: "entry", value: 1 },
        { label: "entry", value: 2 },
      ],
      highlight: undefined,
    });
    expect(parsed.success).toBe(false);
  });

  it("requires one value per x-axis label", () => {
    const parsed = chartSpecSchema.safeParse({
      kind: "line",
      title: "Calls",
      labels: ["a", "b"],
      series: [{ label: "direct", values: [1] }],
    });
    expect(parsed.success).toBe(false);
  });

  it("rejects edges that name undeclared nodes", () => {
    const parsed = chartSpecSchema.safeParse({
      kind: "call_graph",
      title: "Calls",
      nodes: [{ id: "entry", label: "entry" }],
      edges: [{ source: "entry", target: "missing" }],
    });
    expect(parsed.success).toBe(false);
  });
});

describe("formatChartNumber", () => {
  it("groups thousands and drops insignificant decimals without locale state", () => {
    expect(formatChartNumber(1234.5)).toBe("1,234.5");
    expect(formatChartNumber(1000000)).toBe("1,000,000");
    expect(formatChartNumber(0)).toBe("0");
    expect(formatChartNumber(-2500.25)).toBe("-2,500.25");
  });
});

describe("bar chart", () => {
  it("renders a labelled, highlighted figure with values inside the canvas", () => {
    const chart = renderChart({ chart: bar, format: "svg" });
    expect(chart.kind).toBe("bar");
    expect(chart.width).toBe(1120);
    expect(chart.height).toBeGreaterThan(120);
    expect(chart.content).toContain("<svg");
    expect(chart.content).toContain("Observed callers");
    expect(chart.content).toContain("brick_hit");
    expect(chart.content).toContain("1,234.5 calls");
    expect(chart.content).toContain("tile collision path");
    expect(chart.content).not.toContain("<filter");
    expect(chart.content).not.toContain("box-shadow");
    expect(chart.content).toBe(
      renderChart({ chart: bar, format: "svg" }).content,
    );
  });

  it("escapes markup in labels and titles", () => {
    const chart = renderChart({
      chart: {
        kind: "bar",
        title: "A < B & C",
        items: [{ label: '<image href="x">', value: 2 }],
      },
      format: "svg",
    });
    expect(chart.content).toContain("A &lt; B &amp; C");
    expect(chart.content).not.toContain("<image");
  });
});

describe("line chart", () => {
  it("plots every series over the supplied labels and names the unit", () => {
    const chart = renderChart({
      chart: {
        kind: "line",
        title: "Steps per run",
        unit: "steps",
        labels: ["0", "1", "2", "3"],
        series: [
          { label: "observed", values: [4, 8, 16, 32] },
          { label: "modelled", values: [4, 7, 15, 31] },
        ],
        highlight: "observed",
      },
      format: "svg",
    });
    expect(chart.kind).toBe("line");
    expect(chart.content).toContain("<polyline");
    expect(chart.content.match(/<polyline/g)).toHaveLength(2);
    expect(chart.content).toContain("steps");
    expect(chart.content).toContain("observed");
    expect(chart.content).toContain("modelled");
  });
});

describe("call graph chart", () => {
  it("places callees to the right, marks cycles and highlights the selected node", () => {
    const chart = renderChart({
      chart: {
        kind: "call_graph",
        title: "Sound-pan callers",
        nodes: [
          { id: "0x10", label: "entry", depth: 0 },
          { id: "0x20", label: "brick_hit", depth: 1 },
          { id: "0x30", label: "pan_helper", depth: 2 },
        ],
        edges: [
          { source: "0x10", target: "0x20" },
          { source: "0x20", target: "0x30" },
          { source: "0x30", target: "0x20" },
        ],
        highlight: "0x30",
      },
      format: "svg",
    });
    expect(chart.kind).toBe("call_graph");
    expect(chart.content).toMatch(/marker-end="url\(#chart-arrow-[a-z0-9]+\)"/);
    expect(chart.content).toContain('stroke-dasharray="4 3"');
    expect(chart.content).toContain('stroke="#294f82" stroke-width="1.75"');
    expect(chart.content).toContain("pan_helper");
    const columns = [
      ...chart.content.matchAll(/<rect class="chart-node" x="([\d.]+)"/g),
    ].map((match) => Number(match[1]));
    expect(new Set(columns).size).toBe(3);
  });

  it("derives depths from edges when the caller omits them", () => {
    const chart = renderChart({
      chart: {
        kind: "call_graph",
        title: "Derived depth",
        nodes: [
          { id: "root", label: "root" },
          { id: "child", label: "child" },
        ],
        edges: [{ source: "root", target: "child" }],
      },
      format: "svg",
    });
    expect(chart.content.match(/width="210"/g)).toHaveLength(2);
  });
});

describe("HTML delivery", () => {
  it("wraps the same SVG in a standalone document", () => {
    const chart = renderChart({ chart: bar, format: "html" });
    expect(chart.format).toBe("html");
    expect(chart.content.startsWith("<!doctype html>")).toBe(true);
    expect(chart.content).toContain(
      '<figure><svg xmlns="http://www.w3.org/2000/svg"',
    );
    expect(chartHtmlDocument("<svg/>")).toContain("<figure><svg/></figure>");
  });
});
