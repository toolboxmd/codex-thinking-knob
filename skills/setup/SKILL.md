---
name: setup
description: Use when the user asks to configure or activate Codex Thinking Knob in a compatible Codex App Server client.
---

# Set up Codex Thinking Knob

Read the installed package's [installation guide](../../docs/install.md).
Resolve the package root relative to this skill, then verify its launcher with
`node <package-root>/bin/codex-thinking-knob.mjs --version`.

Identify the user's App Server client and its current launch configuration.
When the client supports a configurable command, prepare the exact command
and arguments using the installed launcher path and the verified Codex binary.
Apply setup within the user's requested authority and verify a fresh connection.
If the client lacks that launch surface, report the compatibility limitation.

Completion requires a working launcher connection, not merely an installed
plugin. Keep native update acknowledgement separate from proof that a later
model request used the setting. Installation affects only this module and its
explicit client launch configuration.
