import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

import { z } from "zod";

import { homeDirectoryFromEnvironment } from "../config/homeDirectory.js";
import { GuiError } from "./guiError.js";
import {
  GUI_PROVIDER_IDS,
  guiProviderPreset,
  type GuiProviderId,
  type GuiProviderPreset,
} from "./guiProviderPresets.js";

/** Tools exposed to the model before the operator changes the selection. */
export const GUI_DEFAULT_TOOLS = Object.freeze([
  "open_binary",
  "binary_session",
  "binary_overview",
  "analyze_function",
  "search_strings",
  "search_procedures",
  "list_unknowns",
]);

const toolNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-z0-9_]+$/u, "Tool names use lowercase letters, digits, and `_`");

const baseUrlSchema = z
  .string()
  .trim()
  .max(2048)
  .refine(
    (value) => value === "" || /^https?:\/\/[^\s]+$/u.test(value),
    "Expected an http(s) base URL, or an empty value to choose later",
  );

export const guiSettingsSchema = z.strictObject({
  provider: z.enum(GUI_PROVIDER_IDS).default("ollama"),
  baseUrl: baseUrlSchema.default(""),
  model: z.string().trim().max(200).default(""),
  /** Stored only when the operator saves a key here; environment keys win otherwise. */
  apiKey: z.string().max(4096).default(""),
  autoApproveReadOnly: z.boolean().default(false),
  tools: z
    .array(toolNameSchema)
    .max(64)
    .default([...GUI_DEFAULT_TOOLS]),
});

/**
 * Caller patch. Fields stay optional without inheriting the defaults above, so
 * an omitted endpoint keeps its retained value instead of being reset.
 */
export const guiSettingsPatchSchema = z.strictObject({
  provider: z.enum(GUI_PROVIDER_IDS).optional(),
  baseUrl: z.string().trim().max(2048).optional(),
  model: z.string().trim().max(200).optional(),
  apiKey: z.string().max(4096).optional(),
  autoApproveReadOnly: z.boolean().optional(),
  tools: z.array(toolNameSchema).max(64).optional(),
});

export type GuiSettings = z.output<typeof guiSettingsSchema>;
export type GuiSettingsPatch = z.input<typeof guiSettingsPatchSchema>;

/** Settings with the selected preset's endpoint and model filled in. */
export const defaultGuiSettings = (
  preset: GuiProviderPreset = guiProviderPreset("ollama"),
): GuiSettings =>
  guiSettingsSchema.parse({
    provider: preset.id,
    baseUrl: preset.defaultBaseUrl,
    model: preset.defaultModel,
  });

export const guiSettingsPath = (
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): string => {
  const override = environment.REA_GUI_SETTINGS_PATH?.trim();
  if (override !== undefined && override.length > 0) return override;
  return join(
    homeDirectoryFromEnvironment(environment, platform),
    ".rea",
    "gui.json",
  );
};

const settingsError = (path: string, detail: string, cause?: unknown) =>
  new GuiError(
    "settings",
    `GUI settings at ${path} are unusable: ${detail}`,
    cause === undefined ? {} : { cause },
  );

const readSettingsFile = async (path: string): Promise<string | undefined> => {
  try {
    return await readFile(path, "utf8");
  } catch (cause) {
    if (
      cause !== null &&
      typeof cause === "object" &&
      "code" in cause &&
      cause.code === "ENOENT"
    )
      return undefined;
    throw settingsError(path, "the file could not be read", cause);
  }
};

/** Read the local settings, falling back to the Ollama preset when absent. */
export const loadGuiSettings = async (
  environment: Readonly<Record<string, string | undefined>>,
  platform: NodeJS.Platform = process.platform,
): Promise<GuiSettings> => {
  const path = guiSettingsPath(environment, platform);
  const encoded = await readSettingsFile(path);
  if (encoded === undefined) return defaultGuiSettings();
  let parsed: unknown;
  try {
    parsed = JSON.parse(encoded);
  } catch (cause) {
    throw settingsError(path, "the file is not valid JSON", cause);
  }
  const result = guiSettingsSchema.safeParse(parsed);
  if (!result.success)
    throw settingsError(
      path,
      result.error.issues
        .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
        .join("; "),
    );
  return result.data;
};

/** Persist atomically with owner-only permissions; a failed write leaves no temp file. */
export const saveGuiSettings = async (
  environment: Readonly<Record<string, string | undefined>>,
  selected: GuiSettings,
  platform: NodeJS.Platform = process.platform,
): Promise<void> => {
  const path = guiSettingsPath(environment, platform);
  const validated = guiSettingsSchema.safeParse(selected);
  if (!validated.success)
    throw settingsError(
      path,
      validated.error.issues
        .map((issue) => `${issue.path.join(".") || "value"}: ${issue.message}`)
        .join("; "),
    );
  const temporary = `${path}.${String(process.pid)}.${String(Date.now())}.tmp`;
  try {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(temporary, `${JSON.stringify(validated.data, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600,
    });
    await rename(temporary, path);
  } catch (cause) {
    await unlink(temporary).catch(() => undefined);
    throw settingsError(path, "the file could not be written", cause);
  }
};

/** Apply a caller patch to retained settings, selecting preset defaults on a provider change. */
export const mergeGuiSettings = (
  current: GuiSettings,
  patch: GuiSettingsPatch,
): GuiSettings => {
  const nextPreset: GuiProviderId = patch.provider ?? current.provider;
  const providerChanged = nextPreset !== current.provider;
  const preset = guiProviderPreset(nextPreset);
  return guiSettingsSchema.parse({
    ...current,
    ...patch,
    provider: nextPreset,
    ...(providerChanged && patch.baseUrl === undefined
      ? { baseUrl: preset.defaultBaseUrl }
      : {}),
  });
};

export interface PublicGuiSettings {
  readonly provider: GuiProviderId;
  readonly baseUrl: string;
  readonly model: string;
  readonly autoApproveReadOnly: boolean;
  readonly tools: readonly string[];
  readonly apiKeyConfigured: boolean;
}

/** Resolve the key the next request uses: a saved key, then the preset's variable. */
export const resolveGuiApiKey = (
  settings: Pick<GuiSettings, "provider" | "apiKey">,
  environment: Readonly<Record<string, string | undefined>>,
): string => {
  const saved = settings.apiKey.trim();
  if (saved.length > 0) return saved;
  const preset = guiProviderPreset(settings.provider);
  return environment[preset.apiKeyEnv]?.trim() ?? "";
};

/** Project settings for the browser without disclosing the key itself. */
export const publicGuiSettings = (
  settings: GuiSettings,
  environment: Readonly<Record<string, string | undefined>>,
): PublicGuiSettings => ({
  provider: settings.provider,
  baseUrl: settings.baseUrl,
  model: settings.model,
  autoApproveReadOnly: settings.autoApproveReadOnly,
  tools: settings.tools,
  apiKeyConfigured: resolveGuiApiKey(settings, environment).length > 0,
});
