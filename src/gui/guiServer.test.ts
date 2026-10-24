import { readFile } from "node:fs/promises";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { createLogger } from "../logger.js";
import { startGuiServer, type GuiServerHandle } from "./guiServer.js";
import type { GuiTool, GuiToolBridge, GuiToolResult } from "./guiTools.js";

const logger = createLogger("cli", "silent");

const fakeTools: readonly GuiTool[] = [
  {
    name: "open_binary",
    description: "Open a target",
    parameters: { type: "object", properties: { path: { type: "string" } } },
    readOnly: false,
    effects: ["launchesProcess", "mutatesSession"],
  },
  {
    name: "binary_session",
    description: "Describe the open target",
    parameters: { type: "object", properties: {} },
    readOnly: true,
    effects: [],
  },
];

const sse = (payload: unknown): string =>
  `data: ${JSON.stringify(payload)}\n\n`;

const sseResponse = (body: string): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(body));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );

const chatResponse = (name: string, argumentsJson: string): Response =>
  sseResponse(
    sse({
      choices: [
        {
          delta: {
            tool_calls: [
              {
                index: 0,
                id: "call_1",
                function: { name, arguments: argumentsJson },
              },
            ],
          },
        },
      ],
    }) + "data: [DONE]\n\n",
  );

const textResponse = (text: string): Response =>
  sseResponse(
    sse({ choices: [{ delta: { content: text } }] }) + "data: [DONE]\n\n",
  );

interface Harness {
  readonly server: GuiServerHandle;
  readonly calls: { name: string; arguments: unknown }[];
  readonly fetchImpl: ReturnType<typeof vi.fn<typeof fetch>>;
  readonly settingsPath: string;
}

let harness: Harness | undefined;

const start = async (
  responses: readonly (() => Response)[] = [],
): Promise<Harness> => {
  const root = await createTestTempDirectory("rea-gui-server-");
  const settingsPath = join(root, "gui.json");
  const environment = { REA_GUI_SETTINGS_PATH: settingsPath };
  const calls: { name: string; arguments: unknown }[] = [];
  let index = 0;
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async (input) => {
    const url = String(input);
    if (url.endsWith("/models"))
      return Response.json({ data: [{ id: "model-a" }, { id: "model-b" }] });
    const next = responses[index];
    index += 1;
    if (next === undefined) throw new Error("unexpected provider request");
    return next();
  });
  const callTool = async (
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
  ): Promise<GuiToolResult> => {
    calls.push({ name, arguments: arguments_ });
    return name === "open_binary"
      ? { text: "opened /tmp/sample", isError: false, truncated: false }
      : { text: "no target is open", isError: true, truncated: false };
  };
  const bridge: GuiToolBridge = {
    tools: fakeTools,
    callTool,
    close: async () => undefined,
  };
  const server = await startGuiServer({
    environment,
    logger,
    platform: "linux",
    toolBridge: bridge,
    fetchImpl,
  });
  harness = { server, calls, fetchImpl, settingsPath };
  return harness;
};

const api = async (path: string, init: RequestInit = {}): Promise<Response> => {
  const base = harness?.server.url ?? "http://127.0.0.1:1/";
  return fetch(new URL(path.replace(/^\//u, ""), base), {
    ...init,
    headers: {
      "content-type": "application/json",
      "x-rea-gui-token": harness?.server.token ?? "",
      ...init.headers,
    },
  });
};

interface StreamResult {
  readonly events: { type: string; [key: string]: unknown }[];
  readonly status: number;
}

/** Read one SSE chat response, answering approvals through the HTTP API. */
const runChat = async (
  message: string,
  answer: (id: string) => boolean,
): Promise<StreamResult> => {
  const response = await api("/api/chat", {
    method: "POST",
    body: JSON.stringify({ message }),
  });
  const events: { type: string; [key: string]: unknown }[] = [];
  if (response.body === null) return { events, status: response.status };
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split("\n\n");
    buffer = blocks.pop() ?? "";
    for (const block of blocks) {
      const line = block
        .split("\n")
        .find((entry) => entry.startsWith("data: "));
      if (line === undefined) continue;
      const event = JSON.parse(line.slice(6)) as {
        type: string;
        autoApproved?: boolean;
      };
      events.push(event);
      if (event.type === "tool_call" && event.autoApproved !== true) {
        const id = String((event as { id?: unknown }).id);
        const decided = await api(`/api/approvals/${encodeURIComponent(id)}`, {
          method: "POST",
          body: JSON.stringify({ approve: answer(id) }),
        });
        expect(decided.status).toBe(200);
      }
    }
  }
  return { events, status: response.status };
};

beforeEach(() => {
  harness = undefined;
});

afterEach(async () => {
  await harness?.server.close();
  harness = undefined;
});

describe("GUI server", () => {
  it("serves the shell with its run token and a strict policy", async () => {
    const started = await start();
    const page = await fetch(started.server.url);
    const html = await page.text();
    expect(page.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    expect(html).toContain(started.server.token);
    expect(html).not.toContain("__REA_GUI_TOKEN__");
    expect((await fetch(`${started.server.url}app.js`)).status).toBe(200);
    expect((await fetch(`${started.server.url}missing`)).status).toBe(404);
  });

  it("refuses API calls without the run token", async () => {
    const started = await start();
    const response = await fetch(`${started.server.url}api/state`);
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { kind: "configuration" },
    });
  });

  it("persists settings without returning the key", async () => {
    const started = await start();
    const saved = await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        provider: "openai",
        model: "gpt-4.1-mini",
        apiKey: "sk-local-only",
        autoApproveReadOnly: true,
        tools: ["binary_session"],
      }),
    });
    expect(saved.status).toBe(200);
    const body = (await saved.json()) as Record<string, unknown>;
    expect(body).toMatchObject({
      provider: "openai",
      apiKeyConfigured: true,
      autoApproveReadOnly: true,
      tools: ["binary_session"],
    });
    expect(JSON.stringify(body)).not.toContain("sk-local-only");
    const state = (await (await api("/api/state")).json()) as {
      settings: { provider: string; apiKeyConfigured: boolean };
    };
    expect(state.settings).toMatchObject({
      provider: "openai",
      apiKeyConfigured: true,
    });
    const persisted = JSON.parse(
      await readFile(started.settingsPath, "utf8"),
    ) as Record<string, unknown>;
    expect(persisted).toMatchObject({
      provider: "openai",
      apiKey: "sk-local-only",
    });
  });

  it("lists models through the provider without saving a probe key", async () => {
    const started = await start();
    const response = await api("/api/models", {
      method: "POST",
      body: JSON.stringify({
        provider: "ollama",
        baseUrl: "http://127.0.0.1:11434/v1",
      }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ models: ["model-a", "model-b"] });
    expect(started.fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/models",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("opens a target through the real tool bridge contract", async () => {
    const started = await start();
    const response = await api("/api/target", {
      method: "POST",
      body: JSON.stringify({ path: "/tmp/sample" }),
    });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      target: { path: "/tmp/sample", opened: true },
      text: "opened /tmp/sample",
    });
    expect(started.calls).toEqual([
      { name: "open_binary", arguments: { path: "/tmp/sample" } },
    ]);
    const state = (await (await api("/api/state")).json()) as {
      target: { path: string };
    };
    expect(state.target.path).toBe("/tmp/sample");
  });
});

describe("GUI server turns", () => {
  it("runs an approved tool call and retains the conversation", async () => {
    const started = await start([
      () => chatResponse("open_binary", '{"path":"/tmp/sample"}'),
      () => textResponse("Open. It has not been analyzed yet."),
    ]);
    const result = await runChat("Open /tmp/sample", () => true);
    expect(result.status).toBe(200);
    expect(result.events.map(({ type }) => type)).toEqual([
      "tool_call",
      "tool_result",
      "assistant_text",
      "turn_end",
    ]);
    expect(started.calls).toEqual([
      { name: "open_binary", arguments: { path: "/tmp/sample" } },
    ]);
    expect(result.events.at(-1)).toMatchObject({ reason: "complete" });
    const state = (await (await api("/api/state")).json()) as {
      conversation: { role: string; content: unknown }[];
    };
    expect(state.conversation.map(({ role }) => role)).toEqual([
      "user",
      "assistant",
      "tool",
      "assistant",
    ]);
    expect(state.conversation.at(-1)?.content).toBe(
      "Open. It has not been analyzed yet.",
    );
  });

  it("does not execute a rejected call", async () => {
    const started = await start([
      () => chatResponse("open_binary", '{"path":"/tmp/sample"}'),
      () => textResponse("Understood."),
    ]);
    const result = await runChat("Open /tmp/sample", () => false);
    expect(started.calls).toEqual([]);
    expect(result.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: "tool_result", isError: false }),
        expect.objectContaining({ type: "turn_end", reason: "complete" }),
      ]),
    );
  });
});

describe("GUI server approvals", () => {
  it("auto-runs a read-only call without waiting for the operator", async () => {
    const started = await start([
      () => chatResponse("binary_session", "{}"),
      () => textResponse("No target is open."),
    ]);
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({
        autoApproveReadOnly: true,
        tools: ["binary_session"],
      }),
    });
    const result = await runChat("Is a target open?", () => false);
    expect(result.events[0]).toMatchObject({
      type: "tool_call",
      name: "binary_session",
      autoApproved: true,
    });
    expect(started.calls).toEqual([{ name: "binary_session", arguments: {} }]);
  });

  it("refuses a turn when no tool is exposed", async () => {
    const started = await start();
    await api("/api/settings", {
      method: "PUT",
      body: JSON.stringify({ tools: [] }),
    });
    const response = await api("/api/chat", {
      method: "POST",
      body: JSON.stringify({ message: "Look" }),
    });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      error: { message: expect.stringContaining("at least one tool") },
    });
    expect(started.fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a provider failure as a turn error without running tools", async () => {
    const started = await start([
      () => new Response("model not found", { status: 404 }),
    ]);
    const result = await runChat("Analyze it", () => true);
    expect(started.calls).toEqual([]);
    expect(result.events).toEqual([
      expect.objectContaining({
        type: "turn_end",
        reason: "error",
        message: expect.stringContaining("HTTP 404"),
      }),
    ]);
  });
});
