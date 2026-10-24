/**
 * Chat providers the local GUI can reach. Every entry speaks the OpenAI
 * chat-completions wire format; presets only fill in a base URL, a model
 * suggestion and the environment variable that carries the key.
 */
export const GUI_PROVIDER_IDS = [
  "ollama",
  "lmstudio",
  "opencode",
  "freebuff",
  "openai",
  "openrouter",
  "custom",
] as const;

export type GuiProviderId = (typeof GUI_PROVIDER_IDS)[number];

export interface GuiProviderPreset {
  readonly id: GuiProviderId;
  readonly label: string;
  readonly defaultBaseUrl: string;
  readonly defaultModel: string;
  /** Environment variable consulted when the settings file carries no key. */
  readonly apiKeyEnv: string;
  readonly requiresApiKey: boolean;
  readonly description: string;
}

export const GUI_PROVIDER_PRESETS: readonly GuiProviderPreset[] = Object.freeze(
  [
    {
      id: "ollama",
      label: "Ollama",
      defaultBaseUrl: "http://127.0.0.1:11434/v1",
      defaultModel: "llama3.2",
      apiKeyEnv: "OLLAMA_API_KEY",
      requiresApiKey: false,
      description:
        "Local Ollama daemon. Start it with `ollama serve`; tool calling needs a tool-capable model.",
    },
    {
      id: "lmstudio",
      label: "LM Studio",
      defaultBaseUrl: "http://127.0.0.1:1234/v1",
      defaultModel: "",
      apiKeyEnv: "LMSTUDIO_API_KEY",
      requiresApiKey: false,
      description:
        "LM Studio's local server. Enable the OpenAI-compatible server and load a tool-capable model.",
    },
    {
      id: "opencode",
      label: "OpenCode",
      defaultBaseUrl: "https://opencode.ai/inference/openai/v1",
      defaultModel: "gpt-5.4-mini",
      apiKeyEnv: "OPENCODE_API_KEY",
      requiresApiKey: true,
      description:
        "OpenCode Console (OpenAI-compatible). Create a key at opencode.ai and export OPENCODE_API_KEY.",
    },
    {
      id: "freebuff",
      label: "Freebuff",
      defaultBaseUrl: "",
      defaultModel: "",
      apiKeyEnv: "FREEBUFF_API_KEY",
      requiresApiKey: false,
      description:
        "Freebuff is an agent, not a hosted API. Point this preset at the base URL of a local OpenAI-compatible Freebuff bridge.",
    },
    {
      id: "openai",
      label: "OpenAI",
      defaultBaseUrl: "https://api.openai.com/v1",
      defaultModel: "gpt-4.1-mini",
      apiKeyEnv: "OPENAI_API_KEY",
      requiresApiKey: true,
      description: "OpenAI chat completions with tool calling.",
    },
    {
      id: "openrouter",
      label: "OpenRouter",
      defaultBaseUrl: "https://openrouter.ai/api/v1",
      defaultModel: "openai/gpt-4.1-mini",
      apiKeyEnv: "OPENROUTER_API_KEY",
      requiresApiKey: true,
      description: "OpenRouter's OpenAI-compatible gateway.",
    },
    {
      id: "custom",
      label: "Custom endpoint",
      defaultBaseUrl: "",
      defaultModel: "",
      apiKeyEnv: "REA_GUI_API_KEY",
      requiresApiKey: false,
      description:
        "Any OpenAI-compatible base URL, including llama.cpp, vLLM, or a gateway. The key comes from the settings file or REA_GUI_API_KEY.",
    },
  ],
);

export const guiProviderPreset = (id: GuiProviderId): GuiProviderPreset => {
  const preset = GUI_PROVIDER_PRESETS.find((entry) => entry.id === id);
  if (preset === undefined) throw new Error(`Unknown GUI provider: ${id}`);
  return preset;
};
