# Codex Thinking Knob development

The root direction files own this Project's approved strategy. Issue #5 owns
the native desktop integration. Keep the canonical default branch as the
coordination checkout and give each implementation Issue an exclusive branch
and workspace.

- Runtime: `src/bridge.mjs` owns protocol and effort policy;
  `bin/codex-thinking-knob.mjs` owns process and stream lifecycle.
- Keep the installed runtime dependency-free. Plugin setup, desktop launch,
  resumed-task activation and verified inference are separate states.
- `src/desktop-bridge.mjs` owns desktop state and policy; `src/mcp.mjs` binds
  trusted MCP caller metadata. Preserve the bundled signed native executable.
- `npm test` is the deterministic package gate. With `KNOB_NATIVE_BINARY` set
  to Codex 0.153.4, it also exercises the real App Server against a local fixture.
  A skipped native test is not native proof or behavioral Live Verification.
- Use Astra at low, medium, high or max for development and delegation, and
  independent Luna max review against the exact implementation SHA.
- `VERSION` is canonical; `.version-policy.json` declares its mirrors. Use
  `versionctl` for adoption and transitions. Release and publication are manual.
- The Project Record indexes release-tree facts. Marketplace owns listing and
  release provenance. Follow `docs/proof.md` before publication claims.
- Authenticated Astra use and savings comparisons require separate evidence.
  Native `applied` alone never becomes an execution or savings claim.

## Recent Changes

- 2026-09-07: Established approved Project Direction and the standalone runtime,
  installation and proof boundaries for the first implementation.
