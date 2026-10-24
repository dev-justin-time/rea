/** One typed failure surfaced to the GUI instead of an opaque exception. */
export type GuiErrorKind =
  | "settings"
  | "configuration"
  | "connection"
  | "http"
  | "protocol"
  | "cancelled";

export class GuiError extends Error {
  readonly kind: GuiErrorKind;
  readonly status: number | undefined;

  constructor(
    kind: GuiErrorKind,
    message: string,
    options: { readonly status?: number; readonly cause?: unknown } = {},
  ) {
    super(
      message,
      options.cause === undefined ? undefined : { cause: options.cause },
    );
    this.name = "GuiError";
    this.kind = kind;
    this.status = options.status;
  }
}

/** Collapse provider-controlled text before it reaches a message or the UI. */
export const boundedDetail = (value: string, limit = 300): string => {
  const collapsed = value.replaceAll(/\s+/gu, " ").trim();
  return collapsed.length <= limit
    ? collapsed
    : `${collapsed.slice(0, limit)}…`;
};
