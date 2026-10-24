# Charts, figures and videos

REA can turn observed analysis data into one flat, accessible figure without a
third-party chart runtime. Bar, line and call-graph renderers live in
`src/domain/charts/` and are shared by:

- the MCP tool `render_native_chart`;
- `get_call_graph` with `render: "svg" | "html"`;
- the committed website figures (`npm run chart:figure`);
- the HyperFrames video export (`npm run chart:video`).

A chart is presentation, not evidence. It adds no observations, records no
Evidence and never implies completeness that the underlying observation does not
have. Every cap reports what it omitted.

## Design rules

- Paper white page, charcoal ink, slate secondary text, hairline rules and one
  blue accent. The palette mirrors `website/public/assets/styles.css`.
- No shadows, filters, gradients, 3D, decorative icons or chart libraries.
- Real `<text>` elements, a `<title>`, a `<desc>`, `role="img"` and
  `aria-labelledby`, so a figure stays readable and accessible as SVG.
- Deterministic output: no locale-dependent formatting, timestamps or random
  ids. Re-rendering the same specification produces the same bytes.
- All text is XML-escaped, and oversized labels are shortened with a single
  ellipsis rather than allowed to collide.

## The chart specification

`render_native_chart` accepts a `chart` object and an optional `format`
(`"svg"`, the default, or `"html"` for a standalone page). The same object is the
JSON file used by the figure and video scripts.

### Bar chart

```json
{
  "kind": "bar",
  "title": "Observed callers",
  "description": "Direct callers of the sound-pan helper.",
  "unit": "calls",
  "items": [
    { "label": "brick_hit", "value": 1234.5, "note": "tile collision path" },
    { "label": "menu_draw", "value": 0 }
  ],
  "highlight": "brick_hit"
}
```

- `items`: 1-64 entries of `{label, value, note?}`. `value` is finite and
  non-negative; `note` is a short caption under the bar.
- Labels must be unique so `highlight` can name exactly one bar.
- `unit` is appended to every value.

### Line chart

```json
{
  "kind": "line",
  "title": "Steps per observation window",
  "unit": "steps",
  "labels": ["0-1s", "1-2s", "2-3s"],
  "series": [
    { "label": "baseline", "values": [12, 18, 15] },
    { "label": "patched", "values": [9, 11, 10] }
  ],
  "highlight": "patched"
}
```

- `labels`: 1-64 shared x-axis labels.
- `series`: 1-4 entries; every series needs exactly one value per label, and
  series labels must be unique.
- `highlight` names one series, drawn in ink with a heavier stroke.

### Call graph

```json
{
  "kind": "call_graph",
  "title": "Call graph from 0x1000",
  "nodes": [
    { "id": "0x1000", "label": "main" },
    { "id": "0x1100", "label": "run", "depth": 1 },
    { "id": "0x1200", "label": "draw" }
  ],
  "edges": [
    { "source": "0x1000", "target": "0x1100" },
    { "source": "0x1100", "target": "0x1200" }
  ],
  "highlight": "0x1100"
}
```

- `nodes`: 1-128 entries. `id` is unique and at most 64 characters; `depth`
  (0-32) is optional.
- `edges`: up to 512 directed edges. Both endpoints must name declared nodes and
  self edges are rejected.
- Without explicit depths, roots start in the leftmost column and each callee
  moves one column right. Explicit depths win; callees of an explicitly placed
  node still start one column to its right. Nodes left over inside a cycle join
  column 0 instead of being dropped.
- Backward edges are dashed and carry a lower-opacity stroke.
- The canvas is at least 1120 px wide and widens for many depth columns.

### Limits

`title` is 160 characters, `description` 400, `label` 120, `note` 80 and `unit` 24. Invalid input fails validation with a field path; nothing is rendered.

## MCP: render_native_chart

`render_native_chart` is a read-only session tool. It requires no open target and
does not start a provider.

```json
{
  "chart": {
    "kind": "bar",
    "title": "Observed callers",
    "items": [{ "label": "main", "value": 3 }]
  },
  "format": "svg"
}
```

The result is `{kind, format, width, height, title, content}`. `content` is SVG or
a complete HTML page. In `html` format the page `<title>` matches the chart title.

Charts have no dedicated CLI command; call the tool through MCP. The CLI
otherwise exposes the same analysis data through its normal commands.

## MCP: get_call_graph with a chart

```json
{
  "address": "0x1000",
  "direction": "forward",
  "render": "svg"
}
```

`render` is `none` (default), `svg` or `html`. REA charts the depth groups it
already traversed, so a chart costs no extra provider round trip. The response
keeps the complete `graph` and adds `chart` plus any `limitations`. When the graph
exceeds 128 functions or 512 calls, the chart is capped and a limitation states
how many observed functions and calls it shows. Error nodes are charted like any
other node. The traversal start is highlighted when it is retained.

## Website figures

Compile the renderer once, then render a committed figure:

```bash
npm run compile
npm run chart:figure -- figures/callers.json --out public/assets/figures/callers.svg
```

- `--out` (or `-o`) must end in `.svg` or `.html`; the extension selects the
  format.
- The script validates the specification and fails with the specification path and
  the validation message.
- Commit the rendered SVG. The website build and publication do not need Node or
  the chart renderer.

`python3 scripts/website.py check` uses `scripts/verify-website.py`, which rejects
a published figure under `assets/figures/` (or the social card) that:

- has no `viewBox`;
- has no non-empty `<title>`;
- contains `<filter`, `filter=`, `drop-shadow` or `box-shadow`.

See [website figures](https://github.com/morluto/rea/blob/main/website/figures.md)
for the editorial context.

## Videos

`npm run chart:video -- spec.json --out <dir>` writes a HyperFrames project and
renders MP4:

```bash
npm run chart:video -- figures/callers.json --out .cache/callers-video
npm run chart:video -- figures/callers.json --out .cache/callers-video --no-render
```

Options:

- `--duration <seconds>`: 3-30, default 6.
- `--quality draft|looks|delivery`: HyperFrames render quality, default `draft`.
- `--no-render`: write and check the composition, skip MP4.

The script writes `index.html`, `hyperframes.json` and `package.json` into the
output directory, runs `hyperframes check --json`, then renders `chart.mp4`. The
composition is 1920×1080; bars grow, lines draw and dots or nodes fade in on a
paused GSAP timeline, so frames are deterministic rather than wall-clock
dependent.

Requirements:

- the repository's `hyperframes` dev dependency (`npm install`);
- a Chrome-family browser for frame capture;
- `ffmpeg` and `ffprobe` on `PATH` (the script names whichever is missing);
- network access on the first run, because the composition loads GSAP from its
  CDN.

MP4 rendering is opt-in; `--no-render` still produces and checks the project, so
the pipeline can be reviewed on a host without FFmpeg.

## Verification

```bash
npx vitest run src/domain/charts src/application/native/CallGraphChart.test.ts
npm run compile
node scripts/render-chart-figure.mjs figures/callers.json --out .cache/callers.svg
```

The tests cover validation, XML escaping, layout, caps, HTML delivery and the
Ghidra projection. The website figure rule is covered by the website checks; the
MCP tool is covered by the contract, schema and catalog tests.

## Troubleshooting

- **"The chart renderer is not compiled"**: run `npm run compile`.
- **Validation error**: read the field path in the message; the specification is
  rejected as a whole, not partially rendered.
- **`chart:video` reports missing ffmpeg or ffprobe**: install both, check
  `ffmpeg -version` and `ffprobe -version`, then re-run.
- **HyperFrames rejects the composition**: run with `--no-render`, fix the
  findings printed above the error, then render again.
- **A call-graph chart covers fewer functions than `graph`**: read
  `limitations`; the complete traversal remains in `graph`.
