import { z } from "zod";

import { boundedDetail, GuiError } from "./guiError.js";
import { guiProviderPreset } from "./guiProviderPresets.js";
import { resolveGuiApiKey, type GuiSettings } from "./guiSettings.js";

export interface GuiProviderEndpoint {
  readonly baseUrl: string;
  readonly model: string;
  readonly apiKey: string;
}

export interface ChatToolCall {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
}

export type ChatMessage =
  | { readonly role: "system" | "user"; readonly content: string }
  | {
      readonly role: "assistant";
      readonly content: string | null;
      readonly tool_calls?: readonly ChatToolCall[];
    }
  | {
      readonly role: "tool";
      readonly content: string;
      readonly tool_call_id: string;
    };

export interface ChatToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
}

export type ChatStreamEvent =
  | { readonly type: "text"; readonly text: string }
  | { readonly type: "tool_calls"; readonly calls: readonly ChatToolCall[] };

export const normalizeBaseUrl = (baseUrl: string): string =>
  baseUrl.trim().replace(/\/+$/u, "");

export const chatCompletionsUrl = (baseUrl: string): string =>
  `${normalizeBaseUrl(baseUrl)}/chat/completions`;

export const modelsUrl = (baseUrl: string): string =>
  `${normalizeBaseUrl(baseUrl)}/models`;

/** Validate the URL and credential a discovery request needs. */
export const requireGuiConnection = (
  settings: Pick<GuiSettings, "provider" | "baseUrl" | "apiKey">,
  environment: Readonly<Record<string, string | undefined>>,
): { readonly baseUrl: string; readonly apiKey: string } => {
  const preset = guiProviderPreset(settings.provider);
  const baseUrl = normalizeBaseUrl(settings.baseUrl);
  if (baseUrl.length === 0)
    throw new GuiError(
      "configuration",
      preset.id === "freebuff"
        ? "Freebuff has no hosted API. Start a local OpenAI-compatible Freebuff bridge and enter its base URL."
        : "Choose the provider base URL in the GUI settings.",
    );
  if (!/^https?:\/\/[^\s]+$/u.test(baseUrl))
    throw new GuiError(
      "configuration",
      "The provider base URL must be http(s).",
    );
  const apiKey = resolveGuiApiKey(settings, environment);
  if (preset.requiresApiKey && apiKey.length === 0)
    throw new GuiError(
      "configuration",
      `${preset.label} needs an API key. Save one in the GUI settings or export ${preset.apiKeyEnv}.`,
    );
  return { baseUrl, apiKey };
};

/** Resolve the endpoint a chat request uses, refusing incomplete configuration early. */
export const requireGuiEndpoint = (
  settings: GuiSettings,
  environment: Readonly<Record<string, string | undefined>>,
): GuiProviderEndpoint => {
  const connection = requireGuiConnection(settings, environment);
  const model = settings.model.trim();
  if (model.length === 0)
    throw new GuiError(
      "configuration",
      "Choose the provider model in the GUI settings.",
    );
  return { ...connection, model };
};

const authorization = (apiKey: string): Record<string, string> =>
  apiKey.length === 0 ? {} : { authorization: `Bearer ${apiKey}` };

const responseDetail = async (response: Response): Promise<string> => {
  const body = await response.text().catch(() => "");
  return boundedDetail(body);
};

const connectionError = (
  baseUrl: string,
  cause: unknown,
  action: string,
): GuiError =>
  new GuiError(
    "connection",
    `Could not ${action} ${normalizeBaseUrl(baseUrl)}: ${
      cause instanceof Error
        ? boundedDetail(cause.message)
        : "the request failed"
    }. Check that the provider is running and the base URL is reachable.`,
    { cause },
  );

const modelsResponseSchema = z.object({
  data: z.array(z.object({ id: z.string().min(1) })).optional(),
  models: z.array(z.object({ name: z.string().min(1) })).optional(),
});

/** List the endpoint's model identifiers; Ollama and LM Studio both answer here. */
export const listProviderModels = async (
  endpoint: Pick<GuiProviderEndpoint, "baseUrl" | "apiKey">,
  fetchImpl: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<string[]> => {
  let response: Response;
  try {
    response = await fetchImpl(modelsUrl(endpoint.baseUrl), {
      headers: authorization(endpoint.apiKey),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    if (signal?.aborted)
      throw new GuiError("cancelled", "The model list request was cancelled.", {
        cause,
      });
    throw connectionError(endpoint.baseUrl, cause, "list models at");
  }
  if (!response.ok)
    throw new GuiError(
      "http",
      `The provider answered HTTP ${String(response.status)} for /models: ${await responseDetail(response)}`,
      { status: response.status },
    );
  const parsed = modelsResponseSchema.safeParse(
    await response.json().catch(() => undefined),
  );
  if (!parsed.success)
    throw new GuiError(
      "protocol",
      "The provider returned an unexpected /models response.",
    );
  const ids = [
    ...(parsed.data.data ?? []).map(({ id }) => id),
    ...(parsed.data.models ?? []).map(({ name }) => name),
  ];
  const unique = [...new Set(ids)].sort((left, right) =>
    left.localeCompare(right),
  );
  if (unique.length === 0)
    throw new GuiError(
      "protocol",
      "The provider reported no models on /models.",
    );
  return unique;
};

const streamDeltaSchema = z.object({
  choices: z
    .array(
      z.object({
        delta: z
          .object({
            content: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  index: z.number().int().nonnegative().nullish(),
                  id: z.string().nullish(),
                  function: z
                    .object({
                      name: z.string().nullish(),
                      arguments: z.string().nullish(),
                    })
                    .nullish(),
                }),
              )
              .nullish(),
          })
          .nullish(),
      }),
    )
    .optional(),
});

type PartialToolCall = { id: string; name: string; argumentsJson: string };

interface Accumulator {
  readonly calls: Map<number, PartialToolCall>;
  readonly text: string[];
}

const accumulateDelta = (accumulator: Accumulator, payload: unknown): void => {
  const parsed = streamDeltaSchema.safeParse(payload);
  if (!parsed.success) return;
  const delta = parsed.data.choices?.[0]?.delta;
  if (delta === undefined || delta === null) return;
  if (typeof delta.content === "string" && delta.content.length > 0)
    accumulator.text.push(delta.content);
  for (const [position, call] of (delta.tool_calls ?? []).entries()) {
    const index = call.index ?? position;
    const existing = accumulator.calls.get(index) ?? {
      id: "",
      name: "",
      argumentsJson: "",
    };
    accumulator.calls.set(index, {
      id: call.id ?? existing.id,
      name: call.function?.name ?? existing.name,
      argumentsJson: existing.argumentsJson + (call.function?.arguments ?? ""),
    });
  }
};

const completedCalls = (accumulator: Accumulator): readonly ChatToolCall[] =>
  [...accumulator.calls.entries()]
    .sort(([left], [right]) => left - right)
    .flatMap(([index, call]) =>
      call.name.length === 0
        ? []
        : [
            {
              id: call.id.length > 0 ? call.id : `call_${String(index)}`,
              name: call.name,
              argumentsJson: call.argumentsJson,
            },
          ],
    );

/** Split an SSE buffer into complete `data:` payloads, retaining the partial tail. */
const takeServerEvents = (
  buffer: string,
): { readonly payloads: readonly string[]; readonly rest: string } => {
  const normalized = buffer.replaceAll("\r\n", "\n");
  const blocks = normalized.split("\n\n");
  const rest = blocks.pop() ?? "";
  const payloads = blocks.flatMap((block) =>
    block
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim())
      .filter((line) => line.length > 0),
  );
  return { payloads, rest };
};

const chatBody = (
  endpoint: GuiProviderEndpoint,
  messages: readonly ChatMessage[],
  tools: readonly ChatToolDefinition[],
): Record<string, unknown> => ({
  model: endpoint.model,
  messages: messages.map((message) =>
    message.role === "assistant"
      ? {
          role: message.role,
          content: message.content,
          ...(message.tool_calls === undefined ||
          message.tool_calls.length === 0
            ? {}
            : {
                tool_calls: message.tool_calls.map((call) => ({
                  id: call.id,
                  type: "function",
                  function: { name: call.name, arguments: call.argumentsJson },
                })),
              }),
        }
      : message,
  ),
  ...(tools.length === 0
    ? {}
    : {
        tools: tools.map((tool) => ({
          type: "function",
          function: {
            name: tool.name,
            description: tool.description,
            parameters: tool.parameters,
          },
        })),
        tool_choice: "auto",
      }),
  stream: true,
});

export interface ChatCompletionRequest {
  readonly endpoint: GuiProviderEndpoint;
  readonly messages: readonly ChatMessage[];
  readonly tools: readonly ChatToolDefinition[];
  readonly signal?: AbortSignal;
  readonly fetchImpl?: typeof fetch;
}

const assertStreamResponse = async (response: Response): Promise<void> => {
  if (response.ok) return;
  throw new GuiError(
    "http",
    `The provider answered HTTP ${String(response.status)}: ${await responseDetail(response)}`,
    { status: response.status },
  );
};

const completionSchema = z.object({
  choices: z
    .array(
      z.object({
        message: z
          .object({
            content: z.string().nullish(),
            tool_calls: z
              .array(
                z.object({
                  id: z.string().nullish(),
                  function: z
                    .object({
                      name: z.string().nullish(),
                      arguments: z.string().nullish(),
                    })
                    .nullish(),
                }),
              )
              .nullish(),
          })
          .optional(),
      }),
    )
    .optional(),
});

const parseJsonCompletion = (
  payload: unknown,
  accumulator: Accumulator,
): void => {
  const parsed = completionSchema.safeParse(payload);
  if (!parsed.success) return;
  const message = parsed.data.choices?.[0]?.message;
  if (message === undefined) return;
  if (typeof message.content === "string")
    accumulator.text.push(message.content);
  for (const [index, call] of (message.tool_calls ?? []).entries())
    accumulator.calls.set(index, {
      id: call.id ?? `call_${String(index)}`,
      name: call.function?.name ?? "",
      argumentsJson: call.function?.arguments ?? "",
    });
};

/** Stream one chat completion, yielding text deltas and the final tool-call set. */
export async function* streamChatCompletion(
  request: ChatCompletionRequest,
): AsyncGenerator<ChatStreamEvent> {
  const { endpoint, signal } = request;
  const fetchImpl = request.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(chatCompletionsUrl(endpoint.baseUrl), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...authorization(endpoint.apiKey),
      },
      body: JSON.stringify(chatBody(endpoint, request.messages, request.tools)),
      ...(signal === undefined ? {} : { signal }),
    });
  } catch (cause) {
    if (signal?.aborted)
      throw new GuiError("cancelled", "The provider request was cancelled.", {
        cause,
      });
    throw connectionError(endpoint.baseUrl, cause, "reach");
  }
  await assertStreamResponse(response);
  const accumulator: Accumulator = { calls: new Map(), text: [] };
  if (
    !(response.headers.get("content-type") ?? "").includes("text/event-stream")
  ) {
    parseJsonCompletion(
      await response.json().catch(() => undefined),
      accumulator,
    );
    yield* drain(accumulator);
    return;
  }
  if (response.body === null)
    throw new GuiError(
      "protocol",
      "The provider returned an empty response body.",
    );
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const { payloads, rest } = takeServerEvents(buffer);
      buffer = rest;
      for (const payload of payloads) {
        if (payload === "[DONE]") continue;
        const parsed = ((): unknown => {
          try {
            return JSON.parse(payload);
          } catch {
            return undefined;
          }
        })();
        if (parsed === undefined) continue;
        const before = accumulator.text.length;
        accumulateDelta(accumulator, parsed);
        if (accumulator.text.length > before)
          yield { type: "text", text: accumulator.text.slice(before).join("") };
      }
    }
    const tail = takeServerEvents(`${buffer}\n\n`).payloads;
    for (const payload of tail) {
      if (payload === "[DONE]") continue;
      try {
        accumulateDelta(accumulator, JSON.parse(payload));
      } catch {
        // A truncated final frame is not a completion; the tool set stays withheld.
      }
    }
  } catch (cause) {
    if (signal?.aborted)
      throw new GuiError("cancelled", "The provider request was cancelled.", {
        cause,
      });
    throw new GuiError(
      "connection",
      `The provider stream ended unexpectedly: ${
        cause instanceof Error ? boundedDetail(cause.message) : "unknown cause"
      }.`,
      { cause },
    );
  } finally {
    reader.releaseLock();
  }
  const calls = completedCalls(accumulator);
  if (calls.length > 0) yield { type: "tool_calls", calls };
}

const drain = function* (accumulator: Accumulator): Generator<ChatStreamEvent> {
  const text = accumulator.text.join("");
  if (text.length > 0) yield { type: "text", text };
  const calls = completedCalls(accumulator);
  if (calls.length > 0) yield { type: "tool_calls", calls };
};
