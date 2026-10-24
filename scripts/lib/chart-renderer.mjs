/** Load the compiled chart renderer with one actionable build message. */
export const loadChartRenderer = async () => {
  try {
    return await import("../../dist/domain/charts/renderChart.js");
  } catch (cause) {
    throw new Error(
      "The chart renderer is not compiled. Run `npm run compile` first.\n" +
        (cause instanceof Error ? cause.message : String(cause)),
    );
  }
};
