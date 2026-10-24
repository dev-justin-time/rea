import { z } from "incur";
import type { Logger } from "pino";

import { CLI_COMMANDS } from "../cliCommandNames.js";
import { GuiError } from "../gui/guiError.js";
import { openGuiInBrowser } from "../gui/guiBrowser.js";
import { startGuiServer } from "../gui/guiServer.js";
import { logCliCommand } from "../cliLogging.js";
import type { CliInstance } from "./types.js";
import { withCommandCancellation } from "./commandCancellation.js";

const untilAborted = (signal: AbortSignal): Promise<void> =>
  new Promise((resolve) => {
    if (signal.aborted) resolve();
    else signal.addEventListener("abort", () => resolve(), { once: true });
  });

const runGui = async (
  options: {
    readonly port: number;
    readonly open: boolean;
  },
  environment: Readonly<NodeJS.ProcessEnv>,
  logger: Logger,
  signal: AbortSignal,
): Promise<{ readonly url: string; readonly stopped: boolean }> => {
  if (signal.aborted) throw new GuiError("cancelled", "The GUI was cancelled.");
  const server = await startGuiServer({
    environment,
    logger,
    port: options.port,
  });
  try {
    process.stdout.write(
      `REA GUI listening on ${server.url}\nThe GUI can run analysis tools in this session. Press Ctrl+C to stop.\n`,
    );
    if (options.open && !openGuiInBrowser(server.url))
      process.stderr.write(
        "The default browser could not be opened; use the URL above.\n",
      );
    await untilAborted(signal);
  } finally {
    await server.close();
  }
  return { url: server.url, stopped: true };
};

/** Register the local browser GUI command. */
export const registerGuiCommands = (
  cli: CliInstance,
  logger: Logger,
  environment: Readonly<NodeJS.ProcessEnv>,
): void => {
  cli.command(CLI_COMMANDS.gui, {
    description:
      "Open a local browser GUI that chats with an AI provider and runs REA tools with your approval",
    options: z.object({
      port: z
        .number()
        .int()
        .min(0)
        .max(65535)
        .default(0)
        .describe("Loopback port for the GUI; 0 selects a free port"),
      open: z
        .boolean()
        .default(true)
        .describe("Open the GUI in the default browser"),
    }),
    run: ({ options }) =>
      withCommandCancellation((signal) =>
        logCliCommand(logger, CLI_COMMANDS.gui, () =>
          runGui(options, environment, logger, signal),
        ),
      ),
  });
};
