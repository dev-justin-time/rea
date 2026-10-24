import type {
  ChatMessage,
  ChatStreamEvent,
  ChatToolCall,
  ChatToolDefinition,
} from "./guiProviderClient.js";
import { GuiError } from "./guiError.js";
import type { GuiTool, GuiToolResult } from "./guiTools.js";
import { UNTRUSTED_CONTENT_INSTRUCTIONS } from "../server/toolResultEncoding.js";

/** Maximum model turns per operator message, each turn adding one tool round. */
export const GUI_MAX_ROUNDS = 6;
/** Maximum tool executions per operator message, across every round. */
export const GUI_MAX_TOOL_CALLS = 12;

export const GUI_SYSTEM_PROMPT = [
  "You are REA's investigation assistant running inside its local browser GUI. REA is a local-only reverse-engineering tool: you reach the analysis engine only through the tools it publishes here.",
  "Start from the analyst's question. Open a target with `open_binary` before target-scoped operations, use `binary_session` to check what is currently open, and prefer the narrowest tool that answers the question.",
  "Distinguish what a tool observed from what you infer. Attribute target claims to the observation that supports them, name the tool you used, and keep unverified conclusions explicitly unknown. Never claim you ran something unless its tool result is in this conversation.",
  "Tool calls are approved or rejected by the operator. If a call is rejected, continue with the evidence you already have instead of retrying it or substituting an equivalent side effect.",
  "Keep answers compact: state the finding, the evidence identifier or tool result it rests on, and the next check that would resolve remaining uncertainty.",
  UNTRUSTED_CONTENT_INSTRUCTIONS,
].join("\n\n");

export interface GuiApprovalRequest {
  readonly id: string;
  readonly name: string;
  readonly argumentsJson: string;
  readonly readOnly: boolean;
}

export type GuiAgentEvent =
  | { readonly type: "assistant_text"; readonly text: string }
  | {
      readonly type: "tool_call";
      readonly id: string;
      readonly name: string;
      readonly argumentsJson: string;
      readonly readOnly: boolean;
    }
  | {
      readonly type: "tool_result";
      readonly id: string;
      readonly name: string;
      readonly text: string;
      readonly isError: boolean;
      readonly truncated: boolean;
    }
  | {
      readonly type: "turn_end";
      readonly reason: "complete" | "cancelled" | "limit" | "error";
      readonly message?: string;
    };

export interface GuiAgentDependencies {
  readonly chat: (
    messages: readonly ChatMessage[],
    tools: readonly ChatToolDefinition[],
    signal: AbortSignal | undefined,
  ) => AsyncGenerator<ChatStreamEvent>;
  readonly callTool: (
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
  ) => Promise<GuiToolResult>;
}

export interface GuiAgentTurnInput {
  readonly history: readonly ChatMessage[];
  readonly userMessage: string;
  readonly tools: readonly GuiTool[];
  readonly approve: (
    request: GuiApprovalRequest,
  ) => Promise<"approve" | "reject">;
  readonly dependencies: GuiAgentDependencies;
  readonly signal?: AbortSignal;
  readonly maxRounds?: number;
}

const definitionOf = (tool: GuiTool): ChatToolDefinition => ({
  name: tool.name,
  description: tool.description,
  parameters: tool.parameters,
});

const parseArguments = (
  argumentsJson: string,
): Readonly<Record<string, unknown>> | undefined => {
  if (argumentsJson.trim().length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(argumentsJson);
    return typeof parsed === "object" &&
      parsed !== null &&
      !Array.isArray(parsed)
      ? (parsed as Readonly<Record<string, unknown>>)
      : undefined;
  } catch {
    return undefined;
  }
};

const cancelled = (signal: AbortSignal | undefined, cause: unknown): boolean =>
  signal?.aborted === true ||
  (cause instanceof GuiError && cause.kind === "cancelled");

const errorMessage = (cause: unknown): string =>
  cause instanceof Error ? cause.message : "The turn failed.";

interface ToolOutcome {
  readonly toolMessage: ChatMessage;
  readonly event: GuiAgentEvent;
}

const rejectedOutcome = (call: ChatToolCall, reason: string): ToolOutcome => {
  const text = `The operator did not run this tool call. ${reason}`;
  return {
    toolMessage: { role: "tool", content: text, tool_call_id: call.id },
    event: {
      type: "tool_result",
      id: call.id,
      name: call.name,
      text,
      isError: false,
      truncated: false,
    },
  };
};

const runToolCall = async (
  call: ChatToolCall,
  request: GuiAgentTurnInput,
  selected: GuiTool,
): Promise<ToolOutcome> => {
  const decision = await request.approve({
    id: call.id,
    name: call.name,
    argumentsJson: call.argumentsJson,
    readOnly: selected.readOnly,
  });
  if (decision === "reject")
    return rejectedOutcome(
      call,
      "Continue with the evidence already retained.",
    );
  if (request.signal?.aborted)
    return rejectedOutcome(call, "The turn was cancelled.");
  const arguments_ = parseArguments(call.argumentsJson);
  if (arguments_ === undefined)
    return rejectedOutcome(
      call,
      "The model produced arguments that are not a JSON object.",
    );
  try {
    const result = await request.dependencies.callTool(call.name, arguments_);
    return {
      toolMessage: {
        role: "tool",
        content: result.text,
        tool_call_id: call.id,
      },
      event: {
        type: "tool_result",
        id: call.id,
        name: call.name,
        text: result.text,
        isError: result.isError,
        truncated: result.truncated,
      },
    };
  } catch (cause) {
    const text = errorMessage(cause);
    return {
      toolMessage: { role: "tool", content: text, tool_call_id: call.id },
      event: {
        type: "tool_result",
        id: call.id,
        name: call.name,
        text,
        isError: true,
        truncated: false,
      },
    };
  }
};

const chatTurn = async function* (
  messages: readonly ChatMessage[],
  tools: readonly ChatToolDefinition[],
  request: GuiAgentTurnInput,
): AsyncGenerator<
  GuiAgentEvent,
  | {
      readonly ok: true;
      readonly text: string;
      readonly calls: readonly ChatToolCall[];
    }
  | {
      readonly ok: false;
      readonly cancelled: boolean;
      readonly message: string;
    }
> {
  let text = "";
  let calls: readonly ChatToolCall[] = [];
  try {
    for await (const event of request.dependencies.chat(
      messages,
      tools,
      request.signal,
    )) {
      if (event.type === "text") {
        text += event.text;
        yield { type: "assistant_text", text: event.text };
      } else calls = event.calls;
    }
    return { ok: true, text, calls };
  } catch (cause) {
    return {
      ok: false,
      cancelled: cancelled(request.signal, cause),
      message: errorMessage(cause),
    };
  }
};

/**
 * Run one operator message through the model and its approved tool calls.
 * The generator returns the conversation so the caller retains it; every
 * state change outside this module happens through an approved tool call.
 */
export async function* runAgentTurn(
  request: GuiAgentTurnInput,
): AsyncGenerator<GuiAgentEvent, readonly ChatMessage[]> {
  const conversation: ChatMessage[] = [...request.history];
  conversation.push({ role: "user", content: request.userMessage });
  const definitions = request.tools.map(definitionOf);
  const selected = new Map(request.tools.map((tool) => [tool.name, tool]));
  const maxRounds = request.maxRounds ?? GUI_MAX_ROUNDS;
  let executed = 0;
  for (let round = 0; round <= maxRounds; round += 1) {
    if (request.signal?.aborted) {
      yield { type: "turn_end", reason: "cancelled" };
      return conversation;
    }
    const turn = yield* chatTurn(
      [{ role: "system", content: GUI_SYSTEM_PROMPT }, ...conversation],
      definitions,
      request,
    );
    if (!turn.ok) {
      yield {
        type: "turn_end",
        reason: turn.cancelled ? "cancelled" : "error",
        ...(turn.cancelled || turn.message.length === 0
          ? {}
          : { message: turn.message }),
      };
      return conversation;
    }
    conversation.push(
      turn.text.length === 0 && turn.calls.length === 0
        ? { role: "assistant", content: "(no response)" }
        : {
            role: "assistant",
            content: turn.text.length === 0 ? null : turn.text,
            ...(turn.calls.length === 0 ? {} : { tool_calls: turn.calls }),
          },
    );
    if (turn.calls.length === 0) {
      yield { type: "turn_end", reason: "complete" };
      return conversation;
    }
    if (
      round === maxRounds ||
      executed + turn.calls.length > GUI_MAX_TOOL_CALLS
    ) {
      for (const call of turn.calls) {
        const outcome = rejectedOutcome(
          call,
          "The per-message tool-call limit was reached.",
        );
        conversation.push(outcome.toolMessage);
      }
      yield {
        type: "turn_end",
        reason: "limit",
        message: `Stopped after ${String(executed)} tool calls in this turn. Ask again to continue from the retained evidence.`,
      };
      return conversation;
    }
    for (const call of turn.calls) {
      const tool = selected.get(call.name);
      if (tool === undefined) {
        const outcome = rejectedOutcome(
          call,
          `${call.name} is not exposed in this GUI session.`,
        );
        conversation.push(outcome.toolMessage);
        yield outcome.event;
        continue;
      }
      yield {
        type: "tool_call",
        id: call.id,
        name: call.name,
        argumentsJson: call.argumentsJson,
        readOnly: tool.readOnly,
      };
      const outcome = await runToolCall(call, request, tool);
      conversation.push(outcome.toolMessage);
      executed += 1;
      yield outcome.event;
      if (request.signal?.aborted) {
        yield { type: "turn_end", reason: "cancelled" };
        return conversation;
      }
    }
  }
  yield { type: "turn_end", reason: "limit" };
  return conversation;
}
