import { timingSafeEqual, randomBytes } from "node:crypto";
import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";

import type { Logger } from "pino";
import { z } from "zod";

import { GuiApprovals } from "./guiApprovals.js";
import { runAgentTurn, type GuiAgentEvent } from "./guiAgent.js";
import { GUI_CLIENT_SCRIPT } from "./guiClientScript.js";
import { boundedDetail, GuiError } from "./guiError.js";
import {
  GuiEventStream,
  readGuiJsonBody,
  sendGuiJson,
  sendGuiText,
} from "./guiHttp.js";
import {
  listProviderModels,
  requireGuiConnection,
  requireGuiEndpoint,
  streamChatCompletion,
  type ChatMessage,
} from "./guiProviderClient.js";
import {
  GUI_PROVIDER_IDS,
  GUI_PROVIDER_PRESETS,
} from "./guiProviderPresets.js";
import {
  GUI_DEFAULT_TOOLS,
  guiSettingsPatchSchema,
  loadGuiSettings,
  mergeGuiSettings,
  publicGuiSettings,
  saveGuiSettings,
  type GuiSettings,
} from "./guiSettings.js";
import {
  createGuiToolBridge,
  type GuiTool,
  type GuiToolBridge,
} from "./guiTools.js";
import { GUI_CSS, GUI_HTML } from "./guiWebAssets.js";

export interface GuiTargetState {
  readonly path: string;
  readonly opened: boolean;
  readonly summary: string;
}

export interface GuiServerOptions {
  readonly environment: Readonly<Record<string, string | undefined>>;
  readonly logger: Logger;
  readonly platform?: NodeJS.Platform;
  readonly port?: number;
  readonly fetchImpl?: typeof fetch;
  /** Pre-composed tool bridge; production omits it and the server owns one. */
  readonly toolBridge?: GuiToolBridge;
}

export interface GuiServerHandle {
  readonly url: string;
  readonly token: string;
  close(): Promise<void>;
}

const chatRequestSchema = z.strictObject({
  message: z.string().trim().min(1).max(8000),
});
const targetRequestSchema = z.strictObject({
  path: z.string().trim().min(1).max(4096),
});
const approvalRequestSchema = z.strictObject({ approve: z.boolean() });
const modelsRequestSchema = z.strictObject({
  provider: z.enum(GUI_PROVIDER_IDS).optional(),
  baseUrl: z.string().trim().max(2048).optional(),
  apiKey: z.string().max(4096).optional(),
});

const MAX_HISTORY = 60;

const trimHistory = (
  messages: readonly ChatMessage[],
): readonly ChatMessage[] => {
  if (messages.length <= MAX_HISTORY) return messages;
  const tail = messages.slice(messages.length - MAX_HISTORY);
  const firstUser = tail.findIndex((message) => message.role === "user");
  return firstUser <= 0 ? tail : tail.slice(firstUser);
};

const statusFor = (cause: unknown): number => {
  if (!(cause instanceof GuiError)) return 500;
  switch (cause.kind) {
    case "settings":
    case "configuration":
      return 400;
    case "cancelled":
      return 409;
    case "connection":
    case "http":
    case "protocol":
      return 502;
  }
};

const errorBody = (
  cause: unknown,
): { error: { kind: string; message: string } } => ({
  error: {
    kind: cause instanceof GuiError ? cause.kind : "internal",
    message:
      cause instanceof GuiError
        ? cause.message
        : "The GUI could not complete the request.",
  },
});

const sameToken = (supplied: string, expected: string): boolean => {
  const left = Buffer.from(supplied);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
};

const headerValue = (
  request: IncomingMessage,
  name: string,
): string | undefined => {
  const value = request.headers[name];
  return Array.isArray(value) ? value[0] : value;
};

/** Start the loopback-only GUI and return its URL and per-run request token. */
export const startGuiServer = async (
  options: GuiServerOptions,
): Promise<GuiServerHandle> => {
  const platform = options.platform ?? process.platform;
  const token = randomBytes(24).toString("hex");
  let settings: GuiSettings = await loadGuiSettings(
    options.environment,
    platform,
  );
  let conversation: ChatMessage[] = [];
  let target: GuiTargetState | undefined;
  let activeTurn: AbortController | undefined;
  let activeApprovals: GuiApprovals | undefined;
  let bridgePromise: Promise<GuiToolBridge> | undefined;
  let bridgeError: string | undefined;
  let bridgeTools: readonly GuiTool[] = [];
  const tools = (): readonly GuiTool[] =>
    options.toolBridge?.tools ?? bridgeTools;

  /** Own one analysis session for the lifetime of the GUI, retrying after a failure. */
  const ensureBridge = async (): Promise<GuiToolBridge> => {
    if (options.toolBridge !== undefined) return options.toolBridge;
    bridgePromise ??= createGuiToolBridge(options.environment, options.logger)
      .then((bridge) => {
        bridgeTools = bridge.tools;
        bridgeError = undefined;
        return bridge;
      })
      .catch((cause: unknown) => {
        bridgePromise = undefined;
        bridgeError =
          cause instanceof GuiError
            ? cause.message
            : "The analysis session could not start.";
        throw cause;
      });
    return bridgePromise;
  };

  const statePayload = () => ({
    presets: GUI_PROVIDER_PRESETS,
    defaultTools: GUI_DEFAULT_TOOLS,
    settings: publicGuiSettings(settings, options.environment),
    tools: tools(),
    conversation,
    target,
    ...(bridgeError === undefined ? {} : { bridgeError }),
  });

  const handleState = async (response: ServerResponse): Promise<void> => {
    if (options.toolBridge === undefined)
      await ensureBridge().catch(() => undefined);
    sendGuiJson(response, 200, statePayload());
  };

  const handleSettings = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const patch = guiSettingsPatchSchema.parse(await readGuiJsonBody(request));
    const merged = mergeGuiSettings(settings, patch);
    await saveGuiSettings(options.environment, merged, platform);
    settings = merged;
    sendGuiJson(
      response,
      200,
      publicGuiSettings(settings, options.environment),
    );
  };

  const handleModels = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const body = modelsRequestSchema.parse(await readGuiJsonBody(request));
    const candidate: GuiSettings = {
      ...settings,
      ...(body.provider === undefined ? {} : { provider: body.provider }),
      ...(body.baseUrl === undefined ? {} : { baseUrl: body.baseUrl }),
      ...(body.apiKey === undefined ? {} : { apiKey: body.apiKey }),
    };
    const connection = requireGuiConnection(candidate, options.environment);
    const models = await listProviderModels(
      connection,
      options.fetchImpl ?? fetch,
    );
    sendGuiJson(response, 200, { models });
  };

  const handleTarget = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const body = targetRequestSchema.parse(await readGuiJsonBody(request));
    const bridge = await ensureBridge();
    const result = await bridge.callTool("open_binary", { path: body.path });
    target = {
      path: body.path,
      opened: !result.isError,
      summary: boundedDetail(result.text, 2000),
    };
    sendGuiJson(response, 200, { target, text: result.text });
  };

  const turnChat = async (
    message: string,
    response: ServerResponse,
  ): Promise<void> => {
    if (activeTurn !== undefined)
      throw new GuiError("configuration", "A turn is already running.");
    // Claim the turn before the first await so a second request cannot start.
    const controller = new AbortController();
    const approvals = new GuiApprovals();
    activeTurn = controller;
    activeApprovals = approvals;
    const onClose = (): void => controller.abort();
    response.on("close", onClose);
    let events: GuiEventStream | undefined;
    try {
      const endpoint = requireGuiEndpoint(settings, options.environment);
      const bridge = await ensureBridge();
      const selected = new Set(settings.tools);
      const exposed = bridge.tools.filter((tool) => selected.has(tool.name));
      if (exposed.length === 0)
        throw new GuiError(
          "configuration",
          "Select at least one tool before asking a question.",
        );
      const stream = new GuiEventStream(response);
      events = stream;
      const iterator = runAgentTurn({
        history: conversation,
        userMessage: message,
        tools: exposed,
        signal: controller.signal,
        approve: async (request_) =>
          settings.autoApproveReadOnly && request_.readOnly
            ? "approve"
            : approvals.register(request_.id, controller.signal),
        dependencies: {
          chat: (messages, toolDefinitions, signal) =>
            streamChatCompletion({
              endpoint,
              messages,
              tools: toolDefinitions,
              ...(signal === undefined ? {} : { signal }),
              ...(options.fetchImpl === undefined
                ? {}
                : { fetchImpl: options.fetchImpl }),
            }),
          callTool: (name, arguments_) => bridge.callTool(name, arguments_),
        },
      });
      for (;;) {
        const step = await iterator.next();
        if (step.done === true) {
          conversation = [...step.value];
          break;
        }
        const event = step.value satisfies GuiAgentEvent;
        stream.send(
          event.type === "tool_call" &&
            settings.autoApproveReadOnly &&
            event.readOnly
            ? { ...event, autoApproved: true }
            : event,
        );
      }
    } catch (cause) {
      if (events === undefined) throw cause;
      events.send({
        type: "turn_end",
        reason: "error",
        message: boundedDetail(
          cause instanceof Error ? cause.message : "The turn failed.",
          500,
        ),
      });
    } finally {
      approvals.rejectAll();
      activeTurn = undefined;
      activeApprovals = undefined;
      response.off("close", onClose);
      conversation = [...trimHistory(conversation)];
      events?.end();
    }
  };

  const handleChat = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const body = chatRequestSchema.parse(await readGuiJsonBody(request));
    await turnChat(body.message, response);
  };

  const handleApproval = async (
    request: IncomingMessage,
    response: ServerResponse,
    id: string,
  ): Promise<void> => {
    const body = approvalRequestSchema.parse(await readGuiJsonBody(request));
    if (activeApprovals === undefined)
      throw new GuiError(
        "configuration",
        "No tool call is waiting for approval.",
      );
    activeApprovals.decide(id, body.approve ? "approve" : "reject");
    sendGuiJson(response, 200, { accepted: true });
  };

  const handleStop = (response: ServerResponse): void => {
    const stopped = activeTurn !== undefined;
    activeTurn?.abort();
    activeApprovals?.rejectAll();
    sendGuiJson(response, 200, { stopped });
  };

  const route = async (
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> => {
    const url = new URL(request.url ?? "/", "http://127.0.0.1");
    const method = request.method ?? "GET";
    if (method === "GET" && url.pathname === "/") {
      response.setHeader(
        "content-security-policy",
        "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; img-src 'self' data:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
      );
      return sendGuiText(
        response,
        200,
        "text/html; charset=utf-8",
        GUI_HTML.replace("__REA_GUI_TOKEN__", token),
      );
    }
    if (method === "GET" && url.pathname === "/app.css")
      return sendGuiText(
        response,
        200,
        "text/css; charset=utf-8",
        GUI_CSS,
        "public, max-age=300",
      );
    if (method === "GET" && url.pathname === "/app.js")
      return sendGuiText(
        response,
        200,
        "text/javascript; charset=utf-8",
        GUI_CLIENT_SCRIPT,
        "public, max-age=300",
      );
    if (!url.pathname.startsWith("/api/"))
      return sendGuiJson(
        response,
        404,
        errorBody(new GuiError("configuration", "Not found.")),
      );
    if (!sameToken(headerValue(request, "x-rea-gui-token") ?? "", token))
      throw new GuiError(
        "configuration",
        "The GUI request token is missing or invalid.",
      );
    if (method === "GET" && url.pathname === "/api/state")
      return handleState(response);
    if (method === "PUT" && url.pathname === "/api/settings")
      return handleSettings(request, response);
    if (method === "POST" && url.pathname === "/api/models")
      return handleModels(request, response);
    if (method === "POST" && url.pathname === "/api/target")
      return handleTarget(request, response);
    if (method === "POST" && url.pathname === "/api/chat")
      return handleChat(request, response);
    if (method === "POST" && url.pathname === "/api/chat/stop")
      return handleStop(response);
    const approval = /^\/api\/approvals\/([^/]+)$/u.exec(url.pathname);
    if (method === "POST" && approval?.[1] !== undefined)
      return handleApproval(request, response, decodeURIComponent(approval[1]));
    return sendGuiJson(
      response,
      404,
      errorBody(new GuiError("configuration", "Not found.")),
    );
  };

  const server = createHttpServer((request, response) => {
    void route(request, response).catch((cause: unknown) => {
      if (response.headersSent) {
        response.end();
        return;
      }
      sendGuiJson(response, statusFor(cause), errorBody(cause));
    });
  });
  server.on("clientError", (_error, socket) => {
    socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  if (address === null || typeof address === "string")
    throw new GuiError("configuration", "The GUI listener has no TCP address.");
  return {
    url: `http://127.0.0.1:${String(address.port)}/`,
    token,
    close: async () => {
      activeTurn?.abort();
      activeApprovals?.rejectAll();
      await bridgePromise
        ?.then((bridge) => bridge.close())
        .catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
      server.closeAllConnections();
    },
  };
};
