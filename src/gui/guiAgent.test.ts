import { describe, expect, it, vi } from "vitest";

import {
  GUI_MAX_TOOL_CALLS,
  runAgentTurn,
  type GuiAgentEvent,
  type GuiAgentTurnInput,
} from "./guiAgent.js";
import { GuiError } from "./guiError.js";
import type { ChatMessage, ChatStreamEvent } from "./guiProviderClient.js";
import type { GuiTool } from "./guiTools.js";

const openTool: GuiTool = {
  name: "open_binary",
  description: "Open a target",
  parameters: { type: "object", properties: { path: { type: "string" } } },
  readOnly: false,
  effects: ["launchesProcess", "mutatesSession"],
};

const turnEvents = async (
  input: GuiAgentTurnInput,
): Promise<{ events: GuiAgentEvent[]; messages: readonly ChatMessage[] }> => {
  const iterator = runAgentTurn(input);
  const events: GuiAgentEvent[] = [];
  for (;;) {
    const step = await iterator.next();
    if (step.done === true) return { events, messages: step.value };
    events.push(step.value);
  }
};

const scriptedChat = (
  turns: readonly (readonly ChatStreamEvent[])[],
): GuiAgentTurnInput["dependencies"]["chat"] => {
  const queue = [...turns];
  return vi.fn(async function* (
    _messages: readonly ChatMessage[],
    _tools: readonly unknown[],
    _signal: AbortSignal | undefined,
  ) {
    const turn = queue.shift();
    if (turn === undefined) throw new Error("unexpected extra chat turn");
    yield* turn;
  });
};

const toolCallEvent = (call: {
  id: string;
  name: string;
  argumentsJson: string;
}): ChatStreamEvent => ({ type: "tool_calls", calls: [call] });

describe("GUI agent turn", () => {
  it("returns a text-only answer with the conversation retained", async () => {
    const result = await turnEvents({
      history: [],
      userMessage: "What is open?",
      tools: [],
      approve: vi.fn(),
      dependencies: {
        chat: scriptedChat([[{ type: "text", text: "Nothing yet." }]]),
        callTool: vi.fn(),
      },
    });
    expect(result.events).toEqual([
      { type: "assistant_text", text: "Nothing yet." },
      { type: "turn_end", reason: "complete" },
    ]);
    expect(result.messages).toEqual([
      { role: "user", content: "What is open?" },
      { role: "assistant", content: "Nothing yet." },
    ]);
  });

  it("executes an approved call and continues with its result", async () => {
    const callTool = vi.fn().mockResolvedValue({
      text: "opened /tmp/sample",
      isError: false,
      truncated: false,
    });
    const result = await turnEvents({
      history: [],
      userMessage: "Open /tmp/sample",
      tools: [openTool],
      approve: vi.fn().mockResolvedValue("approve"),
      dependencies: {
        chat: scriptedChat([
          [
            toolCallEvent({
              id: "call_1",
              name: "open_binary",
              argumentsJson: '{"path":"/tmp/sample"}',
            }),
          ],
          [{ type: "text", text: "Opened it." }],
        ]),
        callTool,
      },
    });
    expect(callTool).toHaveBeenCalledWith("open_binary", {
      path: "/tmp/sample",
    });
    expect(result.events).toEqual([
      {
        type: "tool_call",
        id: "call_1",
        name: "open_binary",
        argumentsJson: '{"path":"/tmp/sample"}',
        readOnly: false,
      },
      {
        type: "tool_result",
        id: "call_1",
        name: "open_binary",
        text: "opened /tmp/sample",
        isError: false,
        truncated: false,
      },
      { type: "assistant_text", text: "Opened it." },
      { type: "turn_end", reason: "complete" },
    ]);
    expect(result.messages.at(-3)).toMatchObject({
      role: "assistant",
      tool_calls: [{ id: "call_1", name: "open_binary" }],
    });
    expect(result.messages.at(-2)).toEqual({
      role: "tool",
      content: "opened /tmp/sample",
      tool_call_id: "call_1",
    });
  });

  it("does not execute a rejected call and tells the model why", async () => {
    const callTool = vi.fn();
    const result = await turnEvents({
      history: [],
      userMessage: "Open it",
      tools: [openTool],
      approve: vi.fn().mockResolvedValue("reject"),
      dependencies: {
        chat: scriptedChat([
          [
            toolCallEvent({
              id: "call_2",
              name: "open_binary",
              argumentsJson: '{"path":"/tmp/sample"}',
            }),
          ],
          [{ type: "text", text: "Understood." }],
        ]),
        callTool,
      },
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(result.events[1]).toMatchObject({
      type: "tool_result",
      id: "call_2",
      isError: false,
    });
    expect(result.messages.at(-2)).toMatchObject({
      role: "tool",
      content: expect.stringContaining("did not run"),
    });
  });
});

describe("GUI agent turn safety", () => {
  it("never calls a tool that is not in the exposed selection", async () => {
    const callTool = vi.fn();
    const result = await turnEvents({
      history: [],
      userMessage: "Open it",
      tools: [],
      approve: vi.fn(),
      dependencies: {
        chat: scriptedChat([
          [
            toolCallEvent({
              id: "call_3",
              name: "open_binary",
              argumentsJson: "{}",
            }),
          ],
          [{ type: "text", text: "I cannot open it." }],
        ]),
        callTool,
      },
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(result.events[0]).toMatchObject({
      type: "tool_result",
      id: "call_3",
    });
  });

  it("turns unparsable arguments into a tool message without executing", async () => {
    const callTool = vi.fn();
    const result = await turnEvents({
      history: [],
      userMessage: "Open it",
      tools: [openTool],
      approve: vi.fn().mockResolvedValue("approve"),
      dependencies: {
        chat: scriptedChat([
          [
            toolCallEvent({
              id: "call_4",
              name: "open_binary",
              argumentsJson: "{not json",
            }),
          ],
          [{ type: "text", text: "Retrying with a narrower question." }],
        ]),
        callTool,
      },
    });
    expect(callTool).not.toHaveBeenCalled();
    expect(result.events[1]).toMatchObject({
      type: "tool_result",
      id: "call_4",
      isError: false,
    });
  });

  it("bounds repeated tool rounds and reports the limit", async () => {
    const callTool = vi.fn().mockResolvedValue({
      text: "ok",
      isError: false,
      truncated: false,
    });
    const repeated = () => [
      toolCallEvent({
        id: "call_repeat",
        name: "open_binary",
        argumentsJson: "{}",
      }),
    ];
    const turns = Array.from({ length: GUI_MAX_TOOL_CALLS + 4 }, repeated);
    const result = await turnEvents({
      history: [],
      userMessage: "Loop",
      tools: [openTool],
      maxRounds: 100,
      approve: vi.fn().mockResolvedValue("approve"),
      dependencies: { chat: scriptedChat(turns), callTool },
    });
    expect(callTool).toHaveBeenCalledTimes(GUI_MAX_TOOL_CALLS);
    expect(result.events.at(-1)).toMatchObject({
      type: "turn_end",
      reason: "limit",
    });
  });

  it("reports provider cancellation as a cancelled turn", async () => {
    const controller = new AbortController();
    const result = await turnEvents({
      history: [],
      userMessage: "Look",
      tools: [],
      signal: controller.signal,
      approve: vi.fn(),
      dependencies: {
        chat: async function* () {
          controller.abort();
          throw new GuiError("cancelled", "cancelled");
        },
        callTool: vi.fn(),
      },
    });
    expect(result.events).toEqual([{ type: "turn_end", reason: "cancelled" }]);
  });

  it("reports a provider failure without executing anything", async () => {
    const result = await turnEvents({
      history: [],
      userMessage: "Look",
      tools: [],
      approve: vi.fn(),
      dependencies: {
        chat: async function* () {
          throw new GuiError("http", "The provider answered HTTP 401.");
        },
        callTool: vi.fn(),
      },
    });
    expect(result.events.at(-1)).toMatchObject({
      type: "turn_end",
      reason: "error",
      message: "The provider answered HTTP 401.",
    });
  });
});
