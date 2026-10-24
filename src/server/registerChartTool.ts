import type { EvidenceMcpServer } from "./EvidenceMcpServer.js";

import { toolContract } from "../contracts/toolContracts.js";
import { renderChart } from "../domain/charts/renderChart.js";
import { ok } from "../domain/result.js";
import { toolRegistrationOptions } from "./toolRegistrationOptions.js";

/**
 * Charts are pure projections of supplied analysis data: no provider call, no
 * session mutation and no Evidence record. Registration therefore stays beside
 * the other session-owned read tools without an analysis admission gate.
 */
export const registerChartTool = (server: EvidenceMcpServer): void => {
  const contract = toolContract("render_native_chart");
  server.registerTool(
    contract.name,
    toolRegistrationOptions(contract),
    (input) =>
      server.delivery.toCallToolResult(ok(renderChart(input)), contract),
  );
};
