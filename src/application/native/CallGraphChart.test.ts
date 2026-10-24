import { describe, expect, it } from "vitest";

import { callGraphChart } from "./CallGraphChart.js";

const graph = {
  "0": [
    { address: "0x1000", status: "ok", calls: ["0x2000", "0x3000"] },
    { address: "0x9000", status: "error", error: { code: "unreadable" } },
  ],
  "1": [
    { address: "0x2000", status: "ok", calls: [] },
    { address: "0x3000", status: "ok", calls: ["0x2000"] },
  ],
};

describe("callGraphChart", () => {
  it("charts observed nodes and calls, highlighting the traversal root", () => {
    const { chart, limitations } = callGraphChart(graph, "0x1000", "svg");
    expect(chart.kind).toBe("call_graph");
    expect(chart.format).toBe("svg");
    expect(chart.content).toContain("Call graph from 0x1000");
    for (const address of ["0x1000", "0x2000", "0x3000", "0x9000"])
      expect(chart.content).toContain(address);
    expect(chart.content).toContain('stroke="#294f82" stroke-width="1.75"');
    expect(chart.content).toContain('stroke-dasharray="4 3"');
    expect(limitations).toEqual([]);
  });

  it("returns a standalone HTML page when requested", () => {
    const { chart } = callGraphChart(graph, "0x1000", "html");
    expect(chart.format).toBe("html");
    expect(chart.content.startsWith("<!doctype html>")).toBe(true);
  });

  it("caps very large graphs and reports what the chart omits", () => {
    const rows = Array.from({ length: 140 }, (_, index) => ({
      address: `0x${(0x1000 + index).toString(16)}`,
      status: "ok",
      calls: [],
    }));
    const { chart, limitations } = callGraphChart(
      { "0": rows },
      "0x1000",
      "svg",
    );
    expect(chart.content).toContain("Call graph from 0x1000");
    expect(limitations).toHaveLength(1);
    expect(limitations[0]).toContain("128 of 140 observed functions");
  });
});
