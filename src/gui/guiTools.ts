import { Client, InMemoryTransport } from "@modelcontextprotocol/client";

import { createBinarySession } from "../composition/binary.js";
import { parseConfig } from "../config/parseConfig.js";
import {
  annotationsFromEffects,
  TOOL_EFFECTS,
  type ToolEffects,
} from "../contracts/toolEffects.js";
import { projectAnalysisError } from "../domain/analysisErrorProjection.js";
import { createLogger } from "../logger.js";
import { createServer } from "../server/createServer.js";
import { snapshotEnvironment } from "../process/snapshotEnvironment.js";
import { GuiError } from "./guiError.js";
import { PRODUCT_IDENTITY } from "../identity.js";

/** Bounded tool result text; the full result stays in the MCP session. */
export const GUI_TOOL_TEXT_LIMIT = 24_000;

export interface GuiTool {
  readonly name: string;
  readonly description: string;
  readonly parameters: Readonly<Record<string, unknown>>;
  readonly readOnly: boolean;
  readonly effects: readonly string[];
}

export interface GuiToolResult {
  readonly text: string;
  readonly isError: boolean;
  readonly truncated: boolean;
}

export interface GuiToolBridge {
  readonly tools: readonly GuiTool[];
  callTool(
    name: string,
    arguments_: Readonly<Record<string, unknown>>,
  ): Promise<GuiToolResult>;
  close(): Promise<void>;
}

const effectNames = (effects: ToolEffects | undefined): readonly string[] =>
  effects === undefined
    ? []
    : Object.entries(effects)
        .filter(([, value]) => value === true)
        .map(([name]) => name)
        .sort();

const readOnlyEffects = (effects: ToolEffects | undefined): boolean =>
  effects !== undefined && annotationsFromEffects(effects).readOnlyHint;

const parameterSchema = (schema: unknown): Readonly<Record<string, unknown>> =>
  typeof schema === "object" && schema !== null && !Array.isArray(schema)
    ? (schema as Readonly<Record<string, unknown>>)
    : { type: "object", properties: {} };

const resultText = (result: {
  readonly content?: readonly unknown[];
  readonly structuredContent?: unknown;
}): { readonly text: string; readonly truncated: boolean } => {
  const parts: string[] = [];
  for (const block of result.content ?? []) {
    if (typeof block !== "object" || block === null) continue;
    const type = Reflect.get(block, "type");
    if (type === "text") {
      const text = Reflect.get(block, "text");
      if (typeof text === "string") parts.push(text);
    } else if (type === "resource") {
      const resource = Reflect.get(block, "resource");
      const uri =
        typeof resource === "object" && resource !== null
          ? Reflect.get(resource, "uri")
          : undefined;
      parts.push(
        `[embedded resource${typeof uri === "string" ? ` ${uri}` : ""}]`,
      );
    } else if (type === "image" || type === "audio") {
      parts.push(`[${type} content omitted from the chat transcript]`);
    } else if (typeof type === "string") {
      parts.push(`[${type} content omitted from the chat transcript]`);
    }
  }
  if (parts.length === 0 && result.structuredContent !== undefined)
    parts.push(JSON.stringify(result.structuredContent, null, 2));
  const text = parts.join("\n\n");
  if (text.length <= GUI_TOOL_TEXT_LIMIT) return { text, truncated: false };
  return {
    text: `${text.slice(0, GUI_TOOL_TEXT_LIMIT)}\n\n[truncated at ${String(GUI_TOOL_TEXT_LIMIT)} characters; request a narrower operation for the rest]`,
    truncated: true,
  };
};

/**
 * Compose the same CLI/MCP session the agent uses, then expose its catalog to
 * the GUI through one in-memory MCP connection. Nothing here adds an analysis
 * path: the model calls the published tools, and every call records Evidence
 * exactly as an MCP client would.
 */
export const createGuiToolBridge = async (
  environment: Readonly<Record<string, string | undefined>>,
  logger: ReturnType<typeof createLogger>,
): Promise<GuiToolBridge> => {
  const selectedEnvironment = snapshotEnvironment(environment);
  const config = parseConfig(selectedEnvironment);
  if (!config.ok)
    throw new GuiError(
      "configuration",
      projectAnalysisError(config.error).message,
    );
  const session = createBinarySession(
    config.value,
    logger,
    selectedEnvironment,
  );
  const server = createServer(
    { kind: "session", session },
    { logger, environment: selectedEnvironment },
  );
  const [clientTransport, serverTransport] =
    InMemoryTransport.createLinkedPair();
  const client = new Client({
    name: "rea-gui",
    version: PRODUCT_IDENTITY.packageVersion,
  });
  // Close in ownership order; a failed step must not skip the remaining ones.
  const closeAll = async (): Promise<void> => {
    const failures: unknown[] = [];
    for (const close of [
      () => client.close(),
      () => server.close(),
      () => session.close(),
    ])
      try {
        await close();
      } catch (cause) {
        failures.push(cause);
      }
    if (failures.length > 0)
      throw new AggregateError(failures, "GUI analysis session cleanup failed");
  };
  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
  } catch (cause) {
    await closeAll().catch(() => undefined);
    throw new GuiError(
      "configuration",
      "The analysis session could not start; run `rea doctor` and retry.",
      { cause },
    );
  }
  const listed = await client.listTools();
  const tools = listed.tools.map((tool): GuiTool => {
    const effects = TOOL_EFFECTS[tool.name];
    return {
      name: tool.name,
      description: tool.description ?? tool.name.replaceAll("_", " "),
      parameters: parameterSchema(tool.inputSchema),
      readOnly: readOnlyEffects(effects),
      effects: effectNames(effects),
    };
  });
  tools.sort((left, right) => left.name.localeCompare(right.name));
  return {
    tools,
    callTool: async (name, arguments_) => {
      if (!tools.some((tool) => tool.name === name))
        throw new GuiError(
          "configuration",
          `${name} is not in the current tool selection.`,
        );
      try {
        const result = await client.callTool({
          name,
          arguments: { ...arguments_ },
        });
        const text = resultText(result);
        return {
          text:
            text.text.length === 0
              ? "The tool completed without returning content."
              : text.text,
          isError: result.isError === true,
          truncated: text.truncated,
        };
      } catch (cause) {
        throw new GuiError("protocol", `The ${name} tool call failed.`, {
          cause,
        });
      }
    },
    close: closeAll,
  };
};
