/** Single-page shell; the server injects the per-run request token. */
export const GUI_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>REA investigation GUI</title>
    <link rel="stylesheet" href="/app.css" />
  </head>
  <body data-token="__REA_GUI_TOKEN__">
    <header class="topbar">
      <div>
        <strong>REA</strong>
        <span class="muted">local investigation GUI</span>
      </div>
      <div class="badges">
        <span id="target-badge" class="badge">no target</span>
        <span id="provider-badge" class="badge">provider not set</span>
      </div>
    </header>
    <main class="layout">
      <aside class="sidebar">
        <section class="panel">
          <h2>Provider</h2>
          <label for="provider-select">Preset</label>
          <select id="provider-select"></select>
          <p id="provider-description" class="hint"></p>
          <label for="base-url">Base URL</label>
          <input id="base-url" spellcheck="false" placeholder="http://127.0.0.1:11434/v1" />
          <label for="model-input">Model</label>
          <input id="model-input" spellcheck="false" list="model-list" placeholder="model id" />
          <datalist id="model-list"></datalist>
          <div class="row">
            <button id="list-models" class="secondary">List models</button>
            <button id="save-settings" class="secondary">Save</button>
          </div>
          <label for="api-key">API key</label>
          <input id="api-key" type="password" spellcheck="false" autocomplete="off" />
          <p id="api-key-hint" class="hint"></p>
          <label class="check">
            <input id="auto-approve" type="checkbox" />
            Auto-approve read-only tool calls
          </label>
          <p id="provider-status" class="status" role="status"></p>
        </section>
        <section class="panel">
          <h2>Target</h2>
          <label for="target-path">Local path</label>
          <input id="target-path" spellcheck="false" placeholder="/absolute/path/to/binary" />
          <button id="open-target">Open target</button>
          <p id="target-result" class="hint"></p>
        </section>
        <section class="panel tools">
          <h2>Tools exposed to the model</h2>
          <input id="tool-search" placeholder="Filter tools" spellcheck="false" />
          <div class="row">
            <button id="tools-default" class="secondary">Core set</button>
            <button id="tools-clear" class="secondary">Clear</button>
          </div>
          <p id="tools-count" class="hint"></p>
          <div id="tools" class="tool-list"></div>
        </section>
      </aside>
      <section class="chat">
        <div id="messages" class="messages" aria-live="polite"></div>
        <form id="composer" class="composer">
          <textarea id="message-input" rows="3" placeholder="Ask about the target. The model proposes tool calls; you approve them."></textarea>
          <div class="row">
            <span id="turn-status" class="status" role="status"></span>
            <button id="stop" type="button" class="secondary" disabled>Stop</button>
            <button id="send" type="submit">Send</button>
          </div>
        </form>
      </section>
    </main>
    <div id="toast" class="toast" role="status"></div>
    <script type="module" src="/app.js"></script>
  </body>
</html>
`;

export const GUI_CSS = `:root {
  color-scheme: dark;
  --bg: #0d1117;
  --panel: #161b22;
  --panel-soft: #1c2430;
  --border: #2b3542;
  --text: #e6edf3;
  --muted: #8b98a8;
  --accent: #4aa8ff;
  --ok: #3fb950;
  --warn: #d29922;
  --bad: #f85149;
  font-family: ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
}
* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); color: var(--text); height: 100vh; display: flex; flex-direction: column; }
.topbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; padding: 10px 16px; border-bottom: 1px solid var(--border); }
.muted { color: var(--muted); margin-left: 8px; font-size: 13px; }
.badges { display: flex; gap: 8px; flex-wrap: wrap; }
.badge { border: 1px solid var(--border); border-radius: 999px; padding: 2px 10px; font-size: 12px; color: var(--muted); }
.badge.ok { color: var(--ok); border-color: var(--ok); }
.layout { flex: 1; min-height: 0; display: grid; grid-template-columns: 340px 1fr; }
.sidebar { border-right: 1px solid var(--border); overflow-y: auto; padding: 12px; display: flex; flex-direction: column; gap: 12px; }
.panel { background: var(--panel); border: 1px solid var(--border); border-radius: 10px; padding: 12px; }
.panel h2 { font-size: 13px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin: 0 0 10px; }
label { display: block; font-size: 12px; color: var(--muted); margin: 8px 0 4px; }
input, select, textarea { width: 100%; background: var(--panel-soft); color: var(--text); border: 1px solid var(--border); border-radius: 6px; padding: 7px 9px; font: inherit; font-size: 13px; }
textarea { resize: vertical; min-height: 64px; }
button { background: var(--accent); color: #06121f; border: 0; border-radius: 6px; padding: 7px 12px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
button.secondary { background: var(--panel-soft); color: var(--text); border: 1px solid var(--border); font-weight: 500; }
button:disabled { opacity: 0.5; cursor: default; }
.row { display: flex; gap: 8px; margin-top: 8px; align-items: center; }
.row button { flex: 1; }
.check { display: flex; align-items: center; gap: 8px; margin-top: 10px; color: var(--text); font-size: 13px; }
.check input { width: auto; }
.hint { color: var(--muted); font-size: 12px; margin: 6px 0 0; line-height: 1.4; }
.status { font-size: 12px; color: var(--muted); margin: 8px 0 0; min-height: 16px; }
.status.error { color: var(--bad); }
.status.ok { color: var(--ok); }
.tools { display: flex; flex-direction: column; }
.tool-list { margin-top: 8px; max-height: 300px; overflow-y: auto; display: flex; flex-direction: column; gap: 4px; }
.tool-row { display: flex; gap: 8px; align-items: flex-start; padding: 4px; border-radius: 6px; }
.tool-row:hover { background: var(--panel-soft); }
.tool-row input { width: auto; margin-top: 3px; }
.tool-name { font-size: 12px; font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.tool-meta { font-size: 11px; color: var(--muted); }
.pill { font-size: 10px; border-radius: 999px; padding: 0 6px; margin-left: 6px; border: 1px solid var(--border); color: var(--muted); }
.pill.write { color: var(--warn); border-color: var(--warn); }
.chat { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
.messages { flex: 1; overflow-y: auto; padding: 16px; display: flex; flex-direction: column; gap: 12px; }
.message { border: 1px solid var(--border); border-radius: 10px; padding: 10px 12px; background: var(--panel); max-width: 900px; }
.message.user { align-self: flex-end; background: var(--panel-soft); }
.message.assistant { align-self: flex-start; }
.message.error { border-color: var(--bad); }
.message .who { font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); margin-bottom: 6px; }
.message .body { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 14px; line-height: 1.5; }
.tool-call { align-self: flex-start; border: 1px solid var(--warn); border-radius: 10px; padding: 10px 12px; background: var(--panel); max-width: 900px; width: 100%; }
.tool-call.readonly { border-color: var(--accent); }
.tool-call .title { font-size: 13px; font-weight: 600; margin-bottom: 4px; }
.tool-call pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; color: var(--muted); margin: 6px 0; max-height: 160px; overflow-y: auto; }
.tool-call .decision { display: flex; gap: 8px; }
.tool-call .decision button { flex: 0 0 auto; }
.tool-result { align-self: flex-start; border-left: 3px solid var(--border); padding: 6px 10px; max-width: 900px; width: 100%; }
.tool-result .title { font-size: 12px; color: var(--muted); margin-bottom: 4px; }
.tool-result pre { white-space: pre-wrap; overflow-wrap: anywhere; font-size: 12px; margin: 0; max-height: 220px; overflow-y: auto; }
.tool-result.error { border-left-color: var(--bad); }
.composer { border-top: 1px solid var(--border); padding: 12px 16px; display: flex; flex-direction: column; gap: 8px; }
.composer .row { justify-content: flex-end; }
.composer .status { flex: 1; margin: 0; }
.toast { position: fixed; bottom: 16px; right: 16px; background: var(--panel-soft); border: 1px solid var(--border); border-radius: 8px; padding: 8px 12px; font-size: 13px; opacity: 0; transition: opacity 0.2s; max-width: 480px; }
.toast.visible { opacity: 1; }
.toast.error { border-color: var(--bad); }
@media (max-width: 900px) {
  .layout { grid-template-columns: 1fr; grid-template-rows: auto 1fr; }
  .sidebar { border-right: 0; border-bottom: 1px solid var(--border); max-height: 45vh; }
}
`;
