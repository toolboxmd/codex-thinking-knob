# Native desktop candidate

Issue #5 develops native integration for the ordinary ChatGPT/Codex desktop app.
This candidate is not released or X-ready. The published 0.1.1 package supplies
the earlier stdio launcher and does not include these files.

The candidate uses the existing app's `CODEX_CLI_PATH` executable override.
`bin/thinking-knob-desktop` forwards normal CLI commands to the bundled signed
Codex executable. For App Server it runs a transparent stdio adapter, enables
`step_model_switching`, and creates a private process-owned Unix control socket.
The plugin MCP server inherits that socket and its random token. No app bundle,
global instructions, account credentials, or persistent service is modified.

## Activation

Install a verified candidate plugin containing `.mcp.json`. Keep its exact root.
The desktop launch command is:

```sh
node /absolute/plugin/root/bin/launch-desktop.mjs --thread EXISTING_TASK_UUID
```

Use `--dry-run` to inspect the command first. Quit the app, then run the command
from Terminal. The launcher refuses to silently reuse an already-running app.
Resume the same conversation. Omitting `--thread` opts in all eligible Astra
tasks in that app connection. A scoped launch is recommended for acceptance.
Installation alone cannot change an already-open stdio connection.

The native default path is `/Applications/ChatGPT.app/Contents/Resources/codex`.
The adapter resolves it at each launch so application updates do not retain an
old separately installed CLI. Other app locations and versions need proof.

Quit and open the app normally to remove activation. Remove the plugin through
the plugin manager to remove its tool. This launch command writes no persistent
environment setting. Consequently, ordinary launches after quitting do not
automatically reactivate the candidate.

## Policy and identity

The `thinking_knob.set_effort` MCP tool accepts effort and an optional reason.
Codex supplies task and turn identities in trusted call metadata. Missing or
inconsistent identities fail. The adapter also checks the active turn, current
Astra model, optional task allowlist and fixed policy before calling the native
`turn/settings/update` operation. It never submits a user message or changes
the selected model.

Desktop activation permits adaptation after the initial effort supplied by
the UI. An explicit client `thread/settings/update` or `turn/settings/update`
that changes effort or model locks that task against subsequent adaptation
for the rest of the adapter connection, including resume. Other tasks keep
their policy. Luna and other models cannot use the setter.

The MCP server grants its own mutating tool scoped approval using
`default_tools_approval_mode = "approve"`; it does not label the tool read-only
or alter approval policy for unrelated tools. The control socket uses owner-only
permissions and an ephemeral token. It is removed when the adapter stops.

## Evidence and remaining acceptance

Verified with bundled Codex 0.153.4: a task created before the adapter starts
resumes with the same ID, invokes the MCP tool with native caller metadata,
and sends subsequent provider requests at low, high, then low. This is a
deterministic local-provider test, not an Astra inference or savings claim.

The desktop executable override was separately observed launching the actual
unmodified app. Actual desktop inference, native app/browser compatibility
with the long-lived adapter, and this user's existing conversation remain
required before release or X launch. Native `applied` reports acceptance with
`executionVerified: false` until later request evidence exists.

Computer Use intentionally refuses to automate Codex's own UI. This is an
activation handoff boundary, not a reason to bypass native authorization.
