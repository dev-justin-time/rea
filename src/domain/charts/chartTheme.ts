/**
 * Editorial chart tokens shared by MCP chart output and the website figure
 * pipeline. The palette mirrors website/public/assets/styles.css so generated
 * figures sit beside authored ones without a second visual language: paper
 * white, charcoal ink, muted slate, hairline rules and one blue accent. Nothing
 * here draws a shadow, gradient or border decoration.
 */
export const CHART_THEME = {
  page: "#ffffff",
  ink: "#20252b",
  muted: "#5b6570",
  line: "#e0e5e9",
  soft: "#f4f6f8",
  accent: "#294f82",
  series: ["#294f82", "#20252b", "#6b7f95", "#8aa2b8"] as const,
  font: '-apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif',
  mono: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
} as const;

/** Canvas width shared by authored website figures and generated charts. */
export const CHART_WIDTH = 1120;

/** Deterministic short id so several charts can share one HTML page. */
export const stableChartId = (value: string): string => {
  let hash = 5381;
  for (const character of value)
    hash = ((hash * 33) ^ (character.codePointAt(0) ?? 0)) >>> 0;
  return hash.toString(36);
};

/** Escape the five XML characters that can appear inside SVG text. */
export const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

/**
 * Format a finite number without locale state so regenerating a chart on a
 * different machine produces byte-identical SVG. Thousands group with commas;
 * up to two decimals are kept and trailing zeros are dropped.
 */
export const formatChartNumber = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  const negative = rounded < 0;
  const absolute = Math.abs(rounded);
  const [whole = "0", fraction] = absolute.toString().split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const sign = negative ? "-" : "";
  return fraction === undefined
    ? `${sign}${grouped}`
    : `${sign}${grouped}.${fraction.replace(/0+$/, "")}`;
};

/**
 * Estimate rendered text width from character count. SVG has no text metrics
 * without a browser, so every layout decision uses this conservative estimate;
 * it is deliberately slightly wide so labels are clipped rather than colliding.
 */
export const estimateTextWidth = (
  text: string,
  fontSize: number,
  monospace = false,
): number => {
  const averageGlyph = monospace ? 0.6 : 0.55;
  return [...text].length * fontSize * averageGlyph;
};

/** Shorten a label to the widest prefix that fits, ending in a single ellipsis. */
export const fitLabel = (
  label: string,
  maxWidth: number,
  fontSize: number,
  monospace = false,
): string => {
  if (estimateTextWidth(label, fontSize, monospace) <= maxWidth) return label;
  const characters = [...label];
  while (characters.length > 1) {
    characters.pop();
    const candidate = `${characters.join("")}…`;
    if (estimateTextWidth(candidate, fontSize, monospace) <= maxWidth)
      return candidate;
  }
  return "…";
};

/** Greedy word wrap for titles and descriptions, bounded by a character count. */
export const wrapText = (
  text: string,
  maxCharactersPerLine: number,
  maxLines: number,
): readonly string[] => {
  const words = text.trim().split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let current = "";
  let consumed = 0;
  while (consumed < words.length) {
    const word = words[consumed] ?? "";
    const candidate = current.length === 0 ? word : `${current} ${word}`;
    if (candidate.length <= maxCharactersPerLine || current.length === 0) {
      current = candidate;
      consumed += 1;
      continue;
    }
    lines.push(current);
    current = "";
    if (lines.length === maxLines) break;
  }
  if (current.length > 0 && lines.length < maxLines) lines.push(current);
  if (consumed < words.length && lines.length > 0) {
    const last = lines.at(-1) ?? "";
    lines[lines.length - 1] =
      last.length < maxCharactersPerLine
        ? `${last} …`
        : `${[...last].slice(0, maxCharactersPerLine - 2).join("")}…`;
  }
  return lines;
};
