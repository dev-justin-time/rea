import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, expect, it } from "vitest";

import { InvestigationRecords } from "../application/investigation/InvestigationRecords.js";
import { BinarySession } from "../application/binary/BinarySession.js";
import { AnalysisProviderRegistry } from "../application/binary/AnalysisProviderRegistry.js";
import { SessionProviderRouter } from "../application/binary/SessionProviderRouter.js";
import { createServer } from "./createServer.js";

const AUDIT_TOOL_NAMES = [
  "audit_evidence_coverage",
  "compare_evidence_bundles",
  "diagnose_environment",
  "explain_evidence_chain",
  "export_investigation_report",
  "project_unknown_impact",
  "render_session_chart",
] as const;

const resources: Array<{ close(): Promise<unknown> }> = [];

afterEach(async () => {
  await Promise.all(resources.splice(0).map((resource) => resource.close()));
});

/** Error results carry text only, so read the projected error from its JSON text. */
const errorOf = (result: {
  readonly content?: readonly unknown[];
}): unknown => {
  const block = result.content?.[0];
  const text =
    typeof block === "object" && block !== null && "text" in block
      ? (block as { readonly text: unknown }).text
      : undefined;
  if (typeof text !== "string")
    throw new Error("The failed tool result carries no text");
  return JSON.parse(text) as unknown;
};

const connect = async () => {
  const session = new BinarySession(
    SessionProviderRouter.selectable(new AnalysisProviderRegistry([]), []),
    new InvestigationRecords(),
  );
  const server = createServer({ kind: "session", session });
  const client = new Client({ name: "investigation-audit-test", version: "1" });
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  resources.push({
    close: async () => {
      await client.close();
      await server.close();
      await session.close();
    },
  });
  await server.connect(serverTransport);
  await client.connect(clientTransport);
  return client;
};

it("registers every investigation audit tool", async () => {
  const client = await connect();
  const names = (await client.listTools()).tools.map((tool) => tool.name);
  for (const name of AUDIT_TOOL_NAMES) expect(names).toContain(name);
});

it("projects an empty session without inventing observations", async () => {
  const client = await connect();

  const audit = await client.callTool({
    name: "audit_evidence_coverage",
    arguments: {},
  });
  expect(audit.isError).not.toBe(true);
  expect(audit.structuredContent).toMatchObject({
    result: { totals: { records: 0 }, operations: [], gaps: [] },
  });

  const impact = await client.callTool({
    name: "project_unknown_impact",
    arguments: {},
  });
  expect(impact.isError).not.toBe(true);
  expect(impact.structuredContent).toMatchObject({ result: { unknowns: [] } });

  const report = await client.callTool({
    name: "export_investigation_report",
    arguments: {},
  });
  expect(report.isError).not.toBe(true);
  expect(report.structuredContent).toMatchObject({
    result: { cited_evidence_ids: [], sections: expect.any(Array) },
  });
  const body = (report.structuredContent as { result: { body: string } }).result
    .body;
  expect(body).toContain("# Investigation report");
});

it("fails closed with typed errors for missing data", async () => {
  const client = await connect();

  const absent = await client.callTool({
    name: "explain_evidence_chain",
    arguments: { evidence_id: `ev_${"0".repeat(64)}` },
  });
  expect(absent.isError).toBe(true);
  expect(errorOf(absent)).toMatchObject({
    error: { category: "invalid_input" },
  });

  const emptyChart = await client.callTool({
    name: "render_session_chart",
    arguments: { source: "evidence_operations" },
  });
  expect(emptyChart.isError).toBe(true);
  expect(errorOf(emptyChart)).toMatchObject({
    error: { category: "invalid_input" },
  });

  const missingBundle = await client.callTool({
    name: "compare_evidence_bundles",
    arguments: { path: "/rea-missing-evidence-bundle.json" },
  });
  expect(missingBundle.isError).toBe(true);
  expect(errorOf(missingBundle)).toMatchObject({
    error: { code: expect.any(String) },
  });
});
