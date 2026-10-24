#!/usr/bin/env node
/**
 * Render one website figure from a JSON chart specification.
 *
 * The renderer is the same TypeScript module the MCP chart tool uses, so a
 * committed figure and an agent-generated chart share one palette, type scale
 * and layout. Compile once with `npm run compile` before the first figure.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, extname, resolve } from "node:path";

import { loadChartRenderer } from "./lib/chart-renderer.mjs";

const usage =
  "Usage: node scripts/render-chart-figure.mjs <spec.json> --out <figure.svg|figure.html>";

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
  console.log(usage);
  process.exit(argv.length === 0 ? 1 : 0);
}

const [specPath, ...rest] = argv;
const flagIndex = rest.findIndex(
  (value) => value === "--out" || value === "-o",
);
const outPath = flagIndex === -1 ? undefined : rest[flagIndex + 1];
if (specPath === undefined || outPath === undefined) {
  console.error(usage);
  process.exit(1);
}

const extension = extname(outPath).toLowerCase();
if (extension !== ".svg" && extension !== ".html") {
  console.error("Output must end in .svg or .html");
  process.exit(1);
}
const format = extension === ".html" ? "html" : "svg";

let renderChart;
try {
  ({ renderChart } = await loadChartRenderer());
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
}

let spec;
try {
  spec = JSON.parse(await readFile(resolve(specPath), "utf8"));
} catch (cause) {
  console.error(
    `Cannot read chart specification ${specPath}: ${cause.message}`,
  );
  process.exit(1);
}

let chart;
try {
  chart = renderChart({ chart: spec, format });
} catch (cause) {
  console.error(
    `Invalid chart specification ${specPath}: ${cause instanceof Error ? cause.message : String(cause)}`,
  );
  process.exit(1);
}

const destination = resolve(outPath);
await mkdir(dirname(destination), { recursive: true });
await writeFile(destination, chart.content, "utf8");
console.log(
  `${destination}: ${chart.kind} ${chart.width}x${chart.height} (${format})`,
);
