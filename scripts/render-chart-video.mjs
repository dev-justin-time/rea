#!/usr/bin/env node
/**
 * Turn one chart specification into a checked, seekable HyperFrames
 * composition and, when FFmpeg is installed, an MP4.
 *
 * The scene embeds the same SVG the website and MCP tool produce, then animates
 * named chart primitives with a paused GSAP timeline. HyperFrames owns seeking
 * and frame capture, so the motion is deterministic rather than time-of-day
 * dependent.
 */
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";

import { loadChartRenderer } from "./lib/chart-renderer.mjs";

const usage = `Usage: node scripts/render-chart-video.mjs <spec.json> --out <dir> [options]

Writes a HyperFrames composition around the chart, checks it, then renders MP4.
Options:
  --duration <seconds>  Composition length, 3-30 (default 6)
  --quality <name>      draft, looks or delivery (default draft)
  --no-render           Write the project and run the check only
`;

const argv = process.argv.slice(2);
if (argv.length === 0 || argv.includes("--help") || argv.includes("-h")) {
  console.log(usage);
  process.exit(argv.length === 0 ? 1 : 0);
}

const [specPath, ...rest] = argv;
const option = (name) => {
  const index = rest.findIndex((value) => value === name);
  return index === -1 ? undefined : rest[index + 1];
};
const outDir = option("--out");
if (specPath === undefined || outDir === undefined) {
  console.error(usage);
  process.exit(1);
}
const duration = Math.min(30, Math.max(3, Number(option("--duration") ?? 6)));
if (!Number.isFinite(duration)) {
  console.error("--duration must be a number of seconds");
  process.exit(1);
}
const quality = option("--quality") ?? "draft";
if (!["draft", "looks", "delivery"].includes(quality)) {
  console.error("--quality must be draft, looks or delivery");
  process.exit(1);
}
const noRender = rest.includes("--no-render");

let renderChart;
try {
  ({ renderChart } = await loadChartRenderer());
} catch (cause) {
  console.error(cause instanceof Error ? cause.message : String(cause));
  process.exit(1);
}

const spec = JSON.parse(await readFile(resolve(specPath), "utf8"));
const chart = renderChart({ chart: spec, format: "svg" });
if (chart.format !== "svg") {
  console.error("The video pipeline needs SVG chart markup");
  process.exit(1);
}

const composition = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=1920, height=1080" />
    <script src="https://cdn.jsdelivr.net/npm/gsap@3.14.2/dist/gsap.min.js"></script>
    <style>
      * { margin: 0; padding: 0; box-sizing: border-box; }
      html, body {
        width: 1920px;
        height: 1080px;
        overflow: hidden;
        background: #ffffff;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
      }
      #root {
        position: relative;
        width: 100%;
        height: 100%;
        background: #ffffff;
      }
      #stage {
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      #chart { width: 1680px; }
      #chart svg { display: block; width: 100%; height: auto; }
      #chart .chart-line { stroke-dasharray: 2400; }
    </style>
  </head>
  <body>
    <div
      id="root"
      data-composition-id="main"
      data-start="0"
      data-duration="${duration}"
      data-width="1920"
      data-height="1080"
    >
      <div id="stage">
        <div id="chart">${chart.content}</div>
      </div>
    </div>
    <script>
      const kind = ${JSON.stringify(chart.kind)};
      const tl = gsap.timeline({ paused: true });
      tl.fromTo("#stage", { opacity: 0 }, { opacity: 1, duration: 0.45, ease: "power2.out" }, 0);
      if (kind === "bar")
        tl.fromTo(
          ".chart-bar",
          { scaleX: 0 },
          { scaleX: 1, duration: 0.55, stagger: 0.07, ease: "power3.out", transformOrigin: "0% 50%" },
          0.3,
        );
      if (kind === "line") {
        tl.fromTo(
          ".chart-line",
          { attr: { "stroke-dashoffset": 2400 } },
          { attr: { "stroke-dashoffset": 0 }, duration: 1.3, ease: "power2.inOut" },
          0.3,
        );
        tl.fromTo(".chart-dot", { opacity: 0 }, { opacity: 1, duration: 0.25, stagger: 0.03 }, 1.1);
      }
      if (kind === "call_graph")
        tl.fromTo(
          ".chart-node",
          { opacity: 0, y: 10 },
          { opacity: 1, y: 0, duration: 0.45, stagger: 0.05, ease: "power2.out" },
          0.35,
        );
      window.__timelines["main"] = tl;
      tl.seek(0);
    </script>
  </body>
</html>
`;

const project = resolve(outDir);
await mkdir(project, { recursive: true });
await writeFile(join(project, "index.html"), composition, "utf8");
await writeFile(
  join(project, "hyperframes.json"),
  `${JSON.stringify(
    {
      $schema: "https://hyperframes.heygen.com/schema/hyperframes.json",
      registry:
        "https://raw.githubusercontent.com/heygen-com/hyperframes/main/registry",
      paths: {
        blocks: "compositions",
        components: "compositions/components",
        assets: "assets",
      },
      media: { autoProxy: true },
    },
    null,
    2,
  )}\n`,
  "utf8",
);
await writeFile(
  join(project, "package.json"),
  `${JSON.stringify(
    {
      name: "rea-chart-video",
      private: true,
      type: "module",
      scripts: {
        check: "npx --yes hyperframes@0.8.190 check",
        render: "npx --yes hyperframes@0.8.190 render",
      },
    },
    null,
    2,
  )}\n`,
  "utf8",
);

const bin = resolve("node_modules/hyperframes/bin/hyperframes.mjs");
const run = (args) =>
  spawnSync(process.execPath, [bin, ...args], {
    cwd: project,
    stdio: "inherit",
    env: process.env,
  });

console.log(
  `Wrote ${join(project, "index.html")} (${chart.width}x${chart.height})`,
);
const checked = spawnSync(process.execPath, [bin, "check", "--json"], {
  cwd: project,
  encoding: "utf8",
  env: process.env,
});
const checkOutput = checked.stdout ?? "";
const jsonStart = checkOutput.indexOf("{");
let report;
if (jsonStart !== -1) {
  try {
    report = JSON.parse(checkOutput.slice(jsonStart));
  } catch {
    report = undefined;
  }
}
if (checked.status !== 0 || report?.ok === false) {
  process.stderr.write(checkOutput);
  process.stderr.write(checked.stderr ?? "");
  console.error(
    "HyperFrames rejected the composition; fix the findings above.",
  );
  process.exit(checked.status === 0 ? 1 : checked.status);
}
const warnings = report?.runtime?.warningCount ?? 0;
console.log(
  `HyperFrames check passed${warnings === 0 ? "" : ` with ${warnings} runtime warning(s)`}.`,
);
if (noRender) {
  console.log("Composition checked. Re-run without --no-render to render MP4.");
  process.exit(0);
}

const ffmpeg = spawnSync("ffmpeg", ["-version"], { stdio: "ignore" });
if (ffmpeg.status !== 0) {
  console.error(
    "FFmpeg is required to render MP4. Install it, confirm `ffmpeg -version` works, then re-run.",
  );
  process.exit(1);
}
const rendered = run(["render", "--quality", quality, "--output", "chart.mp4"]);
process.exit(rendered.status ?? 1);
