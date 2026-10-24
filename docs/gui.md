# Local GUI

`rea gui` opens a browser interface over the same analysis session the CLI and
MCP server use. You choose an AI provider, open a target, ask a question, and
approve each tool call the model proposes. The GUI is a presentation and chat
adapter: analyses still run through the published REA tools and record Evidence
exactly as they do from an agent client.

```bash
rea gui
rea gui --port 7391 --no-open
```

The listener binds only to `127.0.0.1`. Each run prints its URL and keeps
running until `Ctrl+C`; the process closes the analysis session when it stops.

## Providers

The GUI talks to any OpenAI-compatible chat-completions endpoint, including
tool calling. Presets fill in a base URL, a model suggestion, and the
environment variable read when no key is saved:

| Preset          | Default endpoint                          | Key variable         |
| --------------- | ----------------------------------------- | -------------------- |
| Ollama          | `http://127.0.0.1:11434/v1`               | `OLLAMA_API_KEY`     |
| LM Studio       | `http://127.0.0.1:1234/v1`                | `LMSTUDIO_API_KEY`   |
| OpenCode        | `https://opencode.ai/inference/openai/v1` | `OPENCODE_API_KEY`   |
| Freebuff        | bridge URL you enter                      | `FREEBUFF_API_KEY`   |
| OpenAI          | `https://api.openai.com/v1`               | `OPENAI_API_KEY`     |
| OpenRouter      | `https://openrouter.ai/api/v1`            | `OPENROUTER_API_KEY` |
| Custom endpoint | URL you enter                             | `REA_GUI_API_KEY`    |

Local providers need no key. Hosted presets refuse a request until a key is
available. Freebuff is an agent rather than a hosted API, so its preset expects
the base URL of a local OpenAI-compatible bridge; REA does not ship or start
one.

Use **List models** to query the endpoint's `/models` route. **Save** writes the
selection, an optional key, and the exposed tool set to
`~/.rea/gui.json` (mode `0600`). A saved key is never returned to the browser;
the UI only reports whether one is configured. Set
`REA_GUI_SETTINGS_PATH` to keep the file elsewhere.

## Tool calling and approval

Only the tools selected in the sidebar are described to the model. The default
selection covers opening and inspecting a target, searching strings and
procedures, analyzing a function, and listing Unknowns; add or filter tools as
the investigation needs them.

The model proposes calls; the GUI shows the tool, its arguments, and whether
the call is read-only. **Approve** runs it in the session and streams the
result back; **Reject** returns a rejection to the model without running
anything. Enable _Auto-approve read-only tool calls_ to skip the prompt for
calls whose audited effects are read-only. Every other call still waits.

A turn stops after six tool rounds or twelve tool calls, whichever comes first.
The last tool result is retained in the conversation, so asking again continues
from the retained evidence. **Stop** cancels the provider request and rejects
any pending approval.

Tool results can contain strings, decompiled code, and logs from the analysis
target. They are data, not instructions; the GUI tells the model to treat them
that way, and the transcript shows the returned text unchanged.

## Target

**Open target** calls `open_binary` with the absolute path you enter. The badge
reports whether the open succeeded. All other analysis tools operate on that
session, and opening another target replaces it with the usual session
semantics.

## Limits

- The GUI is a new adapter over existing tools. It adds no analysis operation,
  no provider, and no Evidence semantics.
- Conversations live in the running process and are not persisted.
- The model sees only tool results in this conversation; it cannot read files
  or run commands outside REA tools.
- The chart, report, and Evidence audit tools are available once selected; they
  read the same retained session state as the MCP adapter.

## Verification

```bash
npx vitest run src/gui
npm run typecheck
```

The tests cover settings persistence and key redaction, provider streaming with
split tool-call frames, approval and rejection, tool-round limits,
cancellation, and an HTTP turn that approves a call and reads the retained
conversation back from the server.
