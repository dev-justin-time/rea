/** Browser client served as /app.js. No HTML is built from provider text. */
export const GUI_CLIENT_SCRIPT = `const token = document.body.dataset.token || "";
const NEWLINE = String.fromCharCode(10);
const byId = (id) => document.getElementById(id);
const state = {
  presets: [],
  defaultTools: [],
  settings: null,
  tools: [],
  conversation: [],
  target: null,
  busy: false,
  apiKeyDirty: false,
  stream: null,
};

const toast = (text, isError) => {
  const element = byId("toast");
  element.textContent = text;
  element.className = isError ? "toast error visible" : "toast visible";
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => {
    element.className = "toast";
  }, isError ? 8000 : 3500);
};

const setStatus = (id, text, kind) => {
  const element = byId(id);
  element.textContent = text;
  element.className = kind ? "status " + kind : "status";
};

const api = async (path, options) => {
  const config = options || {};
  const headers = Object.assign(
    { "content-type": "application/json", "x-rea-gui-token": token },
    config.headers || {},
  );
  const response = await fetch(path, Object.assign({}, config, { headers }));
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message =
      (payload.error && payload.error.message) || "Request failed (" + response.status + ")";
    throw new Error(message);
  }
  return payload;
};

const preset = () => state.presets.find((entry) => entry.id === byId("provider-select").value);

const renderPresets = () => {
  const select = byId("provider-select");
  select.replaceChildren();
  for (const entry of state.presets) {
    const option = document.createElement("option");
    option.value = entry.id;
    option.textContent = entry.label;
    select.append(option);
  }
  select.value = state.settings.provider;
  renderPresetDetails();
};

const renderPresetDetails = () => {
  const selected = preset();
  if (!selected) return;
  byId("provider-description").textContent = selected.description;
  byId("provider-badge").textContent = selected.label;
  const keyHint = selected.requiresApiKey
    ? "Required. Saved here or from " + selected.apiKeyEnv + "."
    : "Optional. Falls back to " + selected.apiKeyEnv + " when saved here is empty.";
  byId("api-key-hint").textContent = keyHint;
  byId("api-key").value = "";
  state.apiKeyDirty = false;
  byId("api-key").placeholder = state.settings.apiKeyConfigured ? "a key is configured" : "not set";
};

const applyProviderChange = () => {
  const selected = preset();
  if (!selected) return;
  const baseUrl = byId("base-url");
  const model = byId("model-input");
  const previous = state.presets.find((entry) => entry.defaultBaseUrl === baseUrl.value);
  if (baseUrl.value.trim() === "" || previous) baseUrl.value = selected.defaultBaseUrl;
  if (model.value.trim() === "") model.value = selected.defaultModel;
  state.settings.apiKeyConfigured = false;
  renderPresetDetails();
  renderTools();
};

const selectedTools = () =>
  Array.from(document.querySelectorAll("#tools input:checked")).map((input) => input.value);

const renderTools = () => {
  const container = byId("tools");
  const filter = byId("tool-search").value.trim().toLowerCase();
  container.replaceChildren();
  const chosen = new Set(state.settings.tools);
  let shown = 0;
  for (const tool of state.tools) {
    if (
      filter &&
      !tool.name.toLowerCase().includes(filter) &&
      !tool.description.toLowerCase().includes(filter)
    )
      continue;
    shown += 1;
    const row = document.createElement("label");
    row.className = "tool-row";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = tool.name;
    input.checked = chosen.has(tool.name);
    input.addEventListener("change", updateToolCount);
    const text = document.createElement("span");
    const name = document.createElement("span");
    name.className = "tool-name";
    name.textContent = tool.name;
    const pill = document.createElement("span");
    pill.className = tool.readOnly ? "pill" : "pill write";
    pill.textContent = tool.readOnly ? "read-only" : "writes";
    name.append(pill);
    const meta = document.createElement("div");
    meta.className = "tool-meta";
    meta.textContent = tool.description;
    text.append(name, meta);
    row.append(input, text);
    container.append(row);
  }
  updateToolCount();
  byId("tools-count").textContent =
    shown + " of " + state.tools.length + " tools shown; " + chosen.size + " selected";
};

const updateToolCount = () => {
  byId("tools-count").textContent =
    document.querySelectorAll("#tools input:checked").length + " tools selected";
};

const setBusy = (busy) => {
  state.busy = busy;
  byId("send").disabled = busy;
  byId("stop").disabled = !busy;
};

const appendMessage = (kind, who, text) => {
  const article = document.createElement("article");
  article.className = "message " + kind;
  const label = document.createElement("div");
  label.className = "who";
  label.textContent = who;
  const body = document.createElement("div");
  body.className = "body";
  body.textContent = text;
  article.append(label, body);
  byId("messages").append(article);
  article.scrollIntoView({ block: "end" });
  return body;
};

const appendToolCall = (event) => {
  const card = document.createElement("article");
  card.className = event.readOnly ? "tool-call readonly" : "tool-call";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent =
    "Tool call: " +
    event.name +
    (event.readOnly ? " (read-only)" : " (writes or runs)") +
    (event.autoApproved ? " — auto-approved" : "");
  const args = document.createElement("pre");
  args.textContent = event.argumentsJson || "{}";
  if (event.autoApproved) {
    card.append(title, args);
    byId("messages").append(card);
    card.scrollIntoView({ block: "end" });
    return;
  }
  const decision = document.createElement("div");
  decision.className = "decision";
  const approve = document.createElement("button");
  approve.textContent = "Approve";
  const reject = document.createElement("button");
  reject.className = "secondary";
  reject.textContent = "Reject";
  const answer = async (value) => {
    approve.disabled = true;
    reject.disabled = true;
    title.textContent = "Tool call: " + event.name + (value ? " — approved" : " — rejected");
    try {
      await api("/api/approvals/" + encodeURIComponent(event.id), {
        method: "POST",
        body: JSON.stringify({ approve: value }),
      });
    } catch (cause) {
      toast(cause.message, true);
    }
  };
  approve.addEventListener("click", () => void answer(true));
  reject.addEventListener("click", () => void answer(false));
  decision.append(approve, reject);
  card.append(title, args, decision);
  byId("messages").append(card);
  card.scrollIntoView({ block: "end" });
};

const appendToolResult = (event) => {
  const block = document.createElement("article");
  block.className = event.isError ? "tool-result error" : "tool-result";
  const title = document.createElement("div");
  title.className = "title";
  title.textContent =
    "Result: " + event.name + (event.isError ? " (error)" : "") + (event.truncated ? " — truncated" : "");
  const body = document.createElement("pre");
  body.textContent = event.text;
  block.append(title, body);
  byId("messages").append(block);
  block.scrollIntoView({ block: "end" });
};

const renderConversation = () => {
  byId("messages").replaceChildren();
  for (const message of state.conversation) {
    if (message.role === "user") appendMessage("user", "you", message.content);
    else if (message.role === "assistant" && message.content)
      appendMessage("assistant", "assistant", message.content);
    else if (message.role === "tool")
      appendToolResult({ name: "tool", text: message.content, isError: false, truncated: false });
  }
};

const handleEvent = (event, assistant) => {
  if (event.type === "assistant_text") {
    assistant.text += event.text;
    assistant.body.textContent = assistant.text;
  } else if (event.type === "tool_call") {
    appendToolCall(event);
    setStatus("turn-status", "Waiting for approval of " + event.name + "…", "");
  } else if (event.type === "tool_result") {
    appendToolResult(event);
    setStatus("turn-status", "Thinking…", "");
  } else if (event.type === "turn_end") {
    if (event.reason === "complete") setStatus("turn-status", "Turn complete.", "ok");
    else if (event.reason === "cancelled") setStatus("turn-status", "Cancelled.", "");
    else if (event.reason === "limit") setStatus("turn-status", event.message || "Tool-call limit reached.", "error");
    else setStatus("turn-status", event.message || "The turn failed.", "error");
    setBusy(false);
  }
};

const readChatStream = async (response) => {
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  const assistant = { text: "", body: appendMessage("assistant", "assistant", "") };
  let buffer = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const blocks = buffer.split(NEWLINE + NEWLINE);
    buffer = blocks.pop() || "";
    for (const block of blocks) {
      const line = block.split(NEWLINE).find((entry) => entry.startsWith("data: "));
      if (!line) continue;
      handleEvent(JSON.parse(line.slice(6)), assistant);
    }
  }
};

const send = async (event) => {
  event.preventDefault();
  const input = byId("message-input");
  const message = input.value.trim();
  if (message.length === 0 || state.busy) return;
  input.value = "";
  appendMessage("user", "you", message);
  setBusy(true);
  setStatus("turn-status", "Contacting the provider…", "");
  try {
    const response = await fetch("/api/chat", {
      method: "POST",
      headers: { "content-type": "application/json", "x-rea-gui-token": token },
      body: JSON.stringify({ message }),
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error((payload.error && payload.error.message) || "The turn failed.");
    }
    await readChatStream(response);
  } catch (cause) {
    setStatus("turn-status", cause.message, "error");
    toast(cause.message, true);
  } finally {
    setBusy(false);
  }
};

const saveSettings = async () => {
  const patch = {
    provider: byId("provider-select").value,
    baseUrl: byId("base-url").value.trim(),
    model: byId("model-input").value.trim(),
    autoApproveReadOnly: byId("auto-approve").checked,
    tools: selectedTools(),
  };
  if (state.apiKeyDirty) patch.apiKey = byId("api-key").value.trim();
  try {
    const saved = await api("/api/settings", { method: "PUT", body: JSON.stringify(patch) });
    state.settings = saved;
    state.apiKeyDirty = false;
    byId("api-key").value = "";
    byId("api-key").placeholder = saved.apiKeyConfigured ? "a key is configured" : "not set";
    setStatus("provider-status", "Settings saved.", "ok");
    toast("Settings saved.");
    renderTools();
  } catch (cause) {
    setStatus("provider-status", cause.message, "error");
    toast(cause.message, true);
  }
};

const listModels = async () => {
  setStatus("provider-status", "Asking the provider…", "");
  const body = {
    provider: byId("provider-select").value,
    baseUrl: byId("base-url").value.trim(),
  };
  if (state.apiKeyDirty) body.apiKey = byId("api-key").value.trim();
  try {
    const result = await api("/api/models", { method: "POST", body: JSON.stringify(body) });
    const list = byId("model-list");
    list.replaceChildren();
    for (const model of result.models) {
      const option = document.createElement("option");
      option.value = model;
      list.append(option);
    }
    if (!byId("model-input").value) byId("model-input").value = result.models[0] || "";
    setStatus("provider-status", result.models.length + " models available.", "ok");
  } catch (cause) {
    setStatus("provider-status", cause.message, "error");
    toast(cause.message, true);
  }
};

const openTarget = async () => {
  const path = byId("target-path").value.trim();
  if (!path) return;
  byId("open-target").disabled = true;
  setStatus("target-result", "Opening…", "");
  try {
    const result = await api("/api/target", { method: "POST", body: JSON.stringify({ path }) });
    state.target = result.target;
    byId("target-badge").textContent = result.target.opened ? "target open" : "target refused";
    byId("target-badge").className = result.target.opened ? "badge ok" : "badge";
    const text = result.text;
    byId("target-result").textContent = text;
    byId("target-result").className = "hint";
    appendToolResult({
      name: "open_binary",
      text: text,
      isError: !result.target.opened,
      truncated: false,
    });
  } catch (cause) {
    byId("target-result").textContent = cause.message;
    setStatus("target-result", cause.message, "error");
    toast(cause.message, true);
  } finally {
    byId("open-target").disabled = false;
  }
};

const stopTurn = async () => {
  try {
    await api("/api/chat/stop", { method: "POST", body: "{}" });
  } catch (cause) {
    toast(cause.message, true);
  }
};

const load = async () => {
  try {
    const result = await api("/api/state", { method: "GET" });
    state.presets = result.presets;
    state.defaultTools = result.defaultTools || [];
    state.settings = result.settings;
    state.tools = result.tools;
    state.conversation = result.conversation;
    state.target = result.target;
    renderPresets();
    byId("base-url").value = state.settings.baseUrl;
    byId("model-input").value = state.settings.model;
    byId("auto-approve").checked = state.settings.autoApproveReadOnly;
    byId("api-key").placeholder = state.settings.apiKeyConfigured ? "a key is configured" : "not set";
    byId("target-badge").textContent = state.target
      ? state.target.opened
        ? "target open"
        : "target refused"
      : "no target";
    byId("target-badge").className = state.target && state.target.opened ? "badge ok" : "badge";
    if (state.target) {
      byId("target-path").value = state.target.path;
      byId("target-result").textContent = state.target.summary;
    }
    renderTools();
    renderConversation();
    if (result.bridgeError) toast(result.bridgeError, true);
  } catch (cause) {
    toast(cause.message, true);
    setStatus("provider-status", cause.message, "error");
  }
};

byId("provider-select").addEventListener("change", applyProviderChange);
byId("api-key").addEventListener("input", () => {
  state.apiKeyDirty = true;
});
byId("save-settings").addEventListener("click", saveSettings);
byId("list-models").addEventListener("click", listModels);
byId("open-target").addEventListener("click", openTarget);
byId("tool-search").addEventListener("input", renderTools);
byId("tools-default").addEventListener("click", () => {
  const defaults = new Set(state.defaultTools);
  for (const input of document.querySelectorAll("#tools input")) input.checked = defaults.has(input.value);
  updateToolCount();
});
byId("tools-clear").addEventListener("click", () => {
  for (const input of document.querySelectorAll("#tools input")) input.checked = false;
  updateToolCount();
});
byId("composer").addEventListener("submit", send);
byId("stop").addEventListener("click", stopTurn);
byId("message-input").addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) {
    event.preventDefault();
    byId("composer").requestSubmit();
  }
});

void load();
`;
