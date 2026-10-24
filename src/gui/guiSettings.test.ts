import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { createTestTempDirectory } from "../../tests/fixtures/temporaryDirectory.js";
import { GuiError } from "./guiError.js";
import {
  defaultGuiSettings,
  GUI_DEFAULT_TOOLS,
  guiSettingsPatchSchema,
  guiSettingsPath,
  loadGuiSettings,
  mergeGuiSettings,
  publicGuiSettings,
  resolveGuiApiKey,
  saveGuiSettings,
} from "./guiSettings.js";
import { guiProviderPreset } from "./guiProviderPresets.js";

const scopedEnvironment = async () => {
  const root = await createTestTempDirectory("rea-gui-settings-");
  const path = join(root, "gui.json");
  return { environment: { REA_GUI_SETTINGS_PATH: path }, path };
};

describe("GUI settings", () => {
  it("defaults to the Ollama preset and the core tool selection", () => {
    const settings = defaultGuiSettings();
    expect(settings).toEqual({
      provider: "ollama",
      baseUrl: guiProviderPreset("ollama").defaultBaseUrl,
      model: guiProviderPreset("ollama").defaultModel,
      apiKey: "",
      autoApproveReadOnly: false,
      tools: [...GUI_DEFAULT_TOOLS],
    });
  });

  it("reads defaults when no settings file exists", async () => {
    const { environment } = await scopedEnvironment();
    await expect(loadGuiSettings(environment, "linux")).resolves.toEqual(
      defaultGuiSettings(),
    );
  });

  it("round-trips saved settings through the local file", async () => {
    const { environment, path } = await scopedEnvironment();
    const selected = {
      ...defaultGuiSettings(guiProviderPreset("opencode")),
      model: "gpt-5.4",
      autoApproveReadOnly: true,
      tools: ["open_binary", "analyze_function"],
    };
    await saveGuiSettings(environment, selected, "linux");
    await expect(loadGuiSettings(environment, "linux")).resolves.toEqual(
      selected,
    );
    const written = JSON.parse(await readFile(path, "utf8")) as Record<
      string,
      unknown
    >;
    expect(Object.keys(written).sort()).toEqual(
      [
        "apiKey",
        "autoApproveReadOnly",
        "baseUrl",
        "model",
        "provider",
        "tools",
      ].sort(),
    );
  });

  it("refuses an unparsable or unknown-shaped file instead of guessing", async () => {
    const { environment, path } = await scopedEnvironment();
    await writeFile(path, "{ not json", "utf8");
    await expect(loadGuiSettings(environment, "linux")).rejects.toMatchObject({
      name: "GuiError",
      kind: "settings",
    });
    await writeFile(
      path,
      JSON.stringify({ provider: "ollama", surprise: true }),
      "utf8",
    );
    await expect(loadGuiSettings(environment, "linux")).rejects.toBeInstanceOf(
      GuiError,
    );
  });

  it("prefers a saved key, then the selected preset's environment variable", () => {
    const settings = {
      ...defaultGuiSettings(guiProviderPreset("openai")),
      apiKey: "saved-key",
    };
    expect(
      resolveGuiApiKey(settings, { OPENAI_API_KEY: "environment-key" }),
    ).toBe("saved-key");
    expect(
      resolveGuiApiKey(
        { ...settings, apiKey: "" },
        { OPENAI_API_KEY: "environment-key" },
      ),
    ).toBe("environment-key");
    expect(resolveGuiApiKey({ ...settings, apiKey: "" }, {})).toBe("");
  });

  it("never returns the key to the browser", () => {
    const settings = {
      ...defaultGuiSettings(guiProviderPreset("openai")),
      apiKey: "saved-key",
    };
    const projected = publicGuiSettings(settings, {});
    expect(projected).toMatchObject({ apiKeyConfigured: true });
    expect(JSON.stringify(projected)).not.toContain("saved-key");
  });

  it("keeps retained fields when a patch omits them", () => {
    const current = defaultGuiSettings(guiProviderPreset("openai"));
    const patch = guiSettingsPatchSchema.parse({ autoApproveReadOnly: true });
    expect(mergeGuiSettings(current, patch)).toEqual({
      ...current,
      autoApproveReadOnly: true,
    });
  });

  it("selects the preset endpoint when the provider changes without an override", () => {
    const merged = mergeGuiSettings(defaultGuiSettings(), {
      provider: "lmstudio",
    });
    expect(merged.baseUrl).toBe(guiProviderPreset("lmstudio").defaultBaseUrl);
    expect(merged.provider).toBe("lmstudio");
    const explicit = mergeGuiSettings(defaultGuiSettings(), {
      provider: "lmstudio",
      baseUrl: "http://127.0.0.1:9999/v1",
    });
    expect(explicit.baseUrl).toBe("http://127.0.0.1:9999/v1");
  });

  it("rejects a non-http base URL before it is persisted", async () => {
    const { environment } = await scopedEnvironment();
    await expect(
      saveGuiSettings(
        environment,
        { ...defaultGuiSettings(), baseUrl: "file:///tmp/socket" },
        "linux",
      ),
    ).rejects.toMatchObject({ kind: "settings" });
  });

  it("resolves the default file under the caller's home directory", () => {
    expect(guiSettingsPath({ HOME: "/home/analyst" }, "linux")).toBe(
      join("/home/analyst", ".rea", "gui.json"),
    );
  });
});
