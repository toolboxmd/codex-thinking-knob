# Codex Thinking Knob

Let Astra adjust its thinking effort as the work changes.

Codex Thinking Knob by ToolboxMD is a standalone stdio wrapper for Codex App
Server. It gives Astra one tool for requesting `low`, `medium`, `high`, or `max`
reasoning effort during its running turn. Changes apply to subsequent model
requests; an already running inference keeps its captured settings.

```text
Your App Server client -> Codex Thinking Knob -> Codex App Server
```

The wrapper has no npm runtime dependencies and requires no other ToolboxMD
modules. It writes no global configuration and runs no background service.
Your client still owns its tasks, credentials, permissions and ordinary tools.

## Compatibility

- Node.js 22 or later; stdio transport on macOS and Linux.
- Codex App Server `0.153.4` is the tested runtime. Its effort update and dynamic
  tools are experimental; other versions require verification.
- Your client must let you configure its App Server launch command and start
  tasks with `model: "gpt-6-astra"`. An omitted model is passed through without
  enabling adaptive control, since its identity has not been established.
- Installing this plugin alone does not connect an unmodified Codex desktop
  application to the wrapper. A client with configurable App Server launch is
  required. Existing desktop tasks cannot be attached to this wrapper or
  switched to adaptive control by installing the plugin.

## Run from a checkout or extracted artifact

Configure your client's command and arguments to launch:

```sh
node /absolute/path/to/codex-thinking-knob/bin/codex-thinking-knob.mjs --adaptive
```

This launches `codex --enable step_model_switching app-server` using `codex`
from `PATH`. Check that executable's version first. For an explicit executable:

```sh
node /absolute/path/to/codex-thinking-knob/bin/codex-thinking-knob.mjs --adaptive -- /absolute/path/to/codex --enable step_model_switching app-server
```

Everything after `--` is the exact child command. The wrapper does not add flags
to a custom command, so include `--enable step_model_switching` yourself.
The default launcher enables this required feature for its process only.

Without `--adaptive`, the wrapper passes the protocol through without adding
the effort tool. `--help` describes the launcher options. stdout is reserved
for the App Server protocol, so run it through your client rather than expecting
an interactive terminal chat.

## How adaptive effort works

With `--adaptive`, initialization enables the experimental App Server API
unless the client explicitly disables it. A successfully started, explicitly
selected Astra task receives `codex_thinking_knob_set_effort` alongside the
client's existing dynamic tools.

The tool accepts an effort and an optional short reason. Its description guides
Astra to use low for routine work, raise effort for material uncertainty, and
lower it once execution becomes routine. This is a selection policy, not an
efficiency guarantee.

The wrapper uses the task and turn IDs supplied by App Server, checks that the
active turn is eligible, and calls `turn/settings/update`. It exposes only
effort. A response with `status: "applied"` means the runtime accepted the change
for subsequent captures. `executionVerified: false` remains explicit because
the wrapper itself cannot observe whether another model request consumed it.

Explicit client effort settings, collaboration modes, model changes and
unproven resumed tasks conservatively disable adaptation. Other models,
including Luna review tasks, retain their own settings. See the precise
[runtime contract](docs/runtime.md) for boundaries and failures.

## Installation and distribution

When a release is published, download its versioned package and checksum from
[GitHub Releases](https://github.com/toolboxmd/codex-thinking-knob/releases).
The Marketplace selector is `codex-thinking-knob@toolboxmd` when listed in the
[ToolboxMD catalog](https://github.com/toolboxmd/marketplace). Release publication
and Marketplace listing are separate steps; check the catalog before installing
through the plugin manager.

The [installation guide](docs/install.md) describes independent package
installation, explicit launcher setup and removal. The same package files
support direct artifact use and an individually selected ToolboxMD Marketplace
installation. Other ToolboxMD modules remain separately selected.

## Verification

```sh
npm test
KNOB_NATIVE_BINARY=/absolute/path/to/codex npm run test:native
```

The native integration test uses the real Codex binary with a local Responses
fixture and an isolated temporary configuration. It observes outgoing request
efforts `low -> high -> low -> low`, including an unchanged next-turn default.
It does not call an OpenAI model or measure savings.

See [proof and release requirements](docs/proof.md) for the distinction between
protocol proof, real Astra use and publication. The underlying App Server
capabilities belong to OpenAI; this project supplies their bounded model-facing
integration. [Official App Server documentation](https://learn.chatgpt.com/docs/app-server)

Discover other independently selected tools in the
[ToolboxMD Marketplace](https://github.com/toolboxmd/marketplace).
