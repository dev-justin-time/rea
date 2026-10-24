import { describe, expect, it, vi } from "vitest";

import { GuiError } from "./guiError.js";
import {
  chatCompletionsUrl,
  listProviderModels,
  requireGuiEndpoint,
  streamChatCompletion,
  type ChatToolCall,
} from "./guiProviderClient.js";
import { defaultGuiSettings } from "./guiSettings.js";
import { guiProviderPreset } from "./guiProviderPresets.js";

const endpoint = {
  baseUrl: "http://127.0.0.1:11434/v1",
  model: "llama3.2",
  apiKey: "",
};

const sseResponse = (chunks: readonly string[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks)
          controller.enqueue(new TextEncoder().encode(chunk));
        controller.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );

const event = (payload: unknown): string =>
  `data: ${JSON.stringify(payload)}\n\n`;

const collect = async (
  generator: AsyncGenerator<unknown>,
): Promise<unknown[]> => {
  const events: unknown[] = [];
  for await (const value of generator) events.push(value);
  return events;
};

describe("GUI provider endpoint", () => {
  it("requires a base URL and model before a request", () => {
    const settings = { ...defaultGuiSettings(), baseUrl: "", model: "" };
    expect(() => requireGuiEndpoint(settings, {})).toThrow(
      /base URL in the GUI settings/u,
    );
    expect(() =>
      requireGuiEndpoint({ ...settings, baseUrl: endpoint.baseUrl }, {}),
    ).toThrow(/Choose the provider model/u);
  });

  it("resolves hosted keys from the preset environment variable", () => {
    const settings = defaultGuiSettings(guiProviderPreset("openai"));
    expect(() => requireGuiEndpoint(settings, {})).toThrow(/needs an API key/u);
    expect(requireGuiEndpoint(settings, { OPENAI_API_KEY: "sk-test" })).toEqual(
      {
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4.1-mini",
        apiKey: "sk-test",
      },
    );
  });

  it("lets a local provider run without a key and strips trailing slashes", () => {
    expect(
      requireGuiEndpoint(
        { ...defaultGuiSettings(), baseUrl: "http://127.0.0.1:11434/v1///" },
        {},
      ),
    ).toEqual(endpoint);
    expect(chatCompletionsUrl("http://host/v1/")).toBe(
      "http://host/v1/chat/completions",
    );
  });

  it("refuses the Freebuff preset until a local bridge URL is configured", () => {
    expect(() =>
      requireGuiEndpoint(defaultGuiSettings(guiProviderPreset("freebuff")), {}),
    ).toThrow(/no hosted API/u);
  });
});

describe("GUI provider model listing", () => {
  it("merges OpenAI-style and Ollama-style model lists", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        data: [{ id: "b-model" }, { id: "a-model" }],
        models: [{ name: "a-model" }, { name: "c-model" }],
      }),
    );
    await expect(listProviderModels(endpoint, fetchImpl)).resolves.toEqual([
      "a-model",
      "b-model",
      "c-model",
    ]);
    expect(fetchImpl).toHaveBeenCalledWith(
      "http://127.0.0.1:11434/v1/models",
      expect.objectContaining({ headers: {} }),
    );
  });

  it("reports the provider status without echoing a key", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("bad key", { status: 401 }));
    const failure = await listProviderModels(
      { ...endpoint, apiKey: "secret-key" },
      fetchImpl,
    ).catch((cause: unknown) => cause);
    expect(failure).toBeInstanceOf(GuiError);
    expect(failure).toMatchObject({ kind: "http", status: 401 });
    expect((failure as Error).message).toContain("401");
    expect((failure as Error).message).not.toContain("secret-key");
  });

  it("turns a refused connection into a reachability message", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockRejectedValue(new TypeError("fetch failed"));
    await expect(listProviderModels(endpoint, fetchImpl)).rejects.toMatchObject(
      {
        kind: "connection",
      },
    );
  });
});

describe("GUI chat streaming", () => {
  it("streams text and assembles tool calls split across frames", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      sseResponse([
        event({ choices: [{ delta: { content: "Opening " } }] }),
        event({ choices: [{ delta: { content: "the target." } }] }),
        event({
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: { name: "open_binary", arguments: '{"pa' },
                  },
                ],
              },
            },
          ],
        }),
        event({
          choices: [
            {
              delta: {
                tool_calls: [
                  { index: 0, function: { arguments: 'th":"/tmp/a"}' } },
                ],
              },
            },
          ],
        }),
        "data: [DONE]\n\n",
      ]),
    );
    const events = await collect(
      streamChatCompletion({ endpoint, messages: [], tools: [], fetchImpl }),
    );
    expect(events).toEqual([
      { type: "text", text: "Opening " },
      { type: "text", text: "the target." },
      {
        type: "tool_calls",
        calls: [
          {
            id: "call_1",
            name: "open_binary",
            argumentsJson: '{"path":"/tmp/a"}',
          } satisfies ChatToolCall,
        ],
      },
    ]);
    const body = JSON.parse(
      (fetchImpl.mock.calls[0]?.[1]?.body as string) ?? "{}",
    ) as Record<string, unknown>;
    expect(body).toMatchObject({ model: "llama3.2", stream: true });
    expect(body.tools).toBeUndefined();
  });

  it("accepts a provider that answers with one JSON document", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      Response.json({
        choices: [
          {
            message: {
              content: "Done.",
              tool_calls: [
                {
                  id: "call_9",
                  function: { name: "binary_session", arguments: "{}" },
                },
              ],
            },
          },
        ],
      }),
    );
    await expect(
      collect(
        streamChatCompletion({ endpoint, messages: [], tools: [], fetchImpl }),
      ),
    ).resolves.toEqual([
      { type: "text", text: "Done." },
      {
        type: "tool_calls",
        calls: [{ id: "call_9", name: "binary_session", argumentsJson: "{}" }],
      },
    ]);
  });

  it("sends only the selected tool schemas", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(sseResponse(["data: [DONE]\n\n"]));
    await collect(
      streamChatCompletion({
        endpoint,
        messages: [{ role: "user", content: "hi" }],
        tools: [
          {
            name: "open_binary",
            description: "Open a target",
            parameters: { type: "object", properties: {} },
          },
        ],
        fetchImpl,
      }),
    );
    const body = JSON.parse(
      (fetchImpl.mock.calls[0]?.[1]?.body as string) ?? "{}",
    ) as Record<string, unknown>;
    expect(body).toMatchObject({
      tools: [
        {
          type: "function",
          function: { name: "open_binary", description: "Open a target" },
        },
      ],
      tool_choice: "auto",
    });
  });

  it("surfaces a provider HTTP failure as one typed error", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("model not found", { status: 404 }));
    await expect(
      collect(
        streamChatCompletion({ endpoint, messages: [], tools: [], fetchImpl }),
      ),
    ).rejects.toMatchObject({ kind: "http", status: 404 });
  });

  it("reports cancellation with the caller's signal", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      controller.abort();
      throw Object.assign(new Error("aborted"), { name: "AbortError" });
    });
    await expect(
      collect(
        streamChatCompletion({
          endpoint,
          messages: [],
          tools: [],
          fetchImpl,
          signal: controller.signal,
        }),
      ),
    ).rejects.toMatchObject({ kind: "cancelled" });
  });
});
