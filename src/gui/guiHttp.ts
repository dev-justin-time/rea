import type { IncomingMessage, ServerResponse } from "node:http";

import { GuiError } from "./guiError.js";

export const GUI_MAX_REQUEST_BYTES = 1_000_000;

/** Read one JSON request body, refusing oversized or non-JSON payloads. */
export const readGuiJsonBody = async (
  request: IncomingMessage,
  limit = GUI_MAX_REQUEST_BYTES,
): Promise<unknown> => {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk));
    size += buffer.byteLength;
    if (size > limit)
      throw new GuiError("configuration", "The request body is too large.");
    chunks.push(buffer);
  }
  if (size === 0) return {};
  const decoded = Buffer.concat(chunks).toString("utf8");
  try {
    return JSON.parse(decoded);
  } catch (cause) {
    throw new GuiError("configuration", "The request body must be JSON.", {
      cause,
    });
  }
};

export const sendGuiJson = (
  response: ServerResponse,
  status: number,
  value: unknown,
): void => {
  const body = JSON.stringify(value);
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body),
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
  });
  response.end(body);
};

export const sendGuiText = (
  response: ServerResponse,
  status: number,
  contentType: string,
  body: string,
  cacheControl = "no-store",
): void => {
  response.writeHead(status, {
    "content-type": contentType,
    "content-length": Buffer.byteLength(body),
    "cache-control": cacheControl,
    "x-content-type-options": "nosniff",
    "referrer-policy": "no-referrer",
  });
  response.end(body);
};

/** Server-sent events over one POST response; closed streams drop writes. */
export class GuiEventStream {
  readonly #response: ServerResponse;

  constructor(response: ServerResponse) {
    this.#response = response;
    response.writeHead(200, {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
      "x-content-type-options": "nosniff",
    });
    response.flushHeaders();
  }

  send(payload: unknown): void {
    if (this.#response.writableEnded || this.#response.destroyed) return;
    this.#response.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  end(): void {
    if (this.#response.writableEnded || this.#response.destroyed) return;
    this.#response.end();
  }
}
