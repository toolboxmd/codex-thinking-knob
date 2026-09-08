# Proof and release requirements

The package's deterministic gate is `npm test`. The native seam additionally
requires `KNOB_NATIVE_BINARY=/absolute/path/to/codex npm run test:native` with
Codex 0.153.4. It runs both the custom-client and desktop integration tests.
CI runs both gates using the pinned Codex package.

The native test creates a temporary Codex configuration pointing at a loopback
Responses fixture. It supplies deterministic tool calls, observes the real App
Server's subsequent request efforts, and deletes its temporary state afterward.
It neither authenticates to OpenAI nor performs a real Astra inference. This
proves integration semantics, not the model's judgment or general efficiency.

The wrapper correctly keeps `executionVerified: false` in normal tool results.
The native fixture's separate observer supplies execution evidence only for
that test. An accepted update is not evidence that a later inference happened.

Real-Astra observations are recorded in the exact version's
[release notes](https://github.com/toolboxmd/codex-thinking-knob/releases),
separately from this deterministic gate. Until those notes include request-level
evidence, real-Astra execution is not established for that release. This
repository gate alone does not supply it.

Before publication:

- Review the exact implementation SHA with Luna at max, address findings and
  run the complete deterministic gate on the final tree.
- Use `versionctl release-check` on the clean commit. Build one package from
  that exact SHA and retain its SHA-256 with the release identity.
- Verify real Astra work through a supported client under explicit authority.
  Observe both upward and downward effort changes and completion quality.
- Publish the exact immutable wrapper release, then ingest its Project Record
  into ToolboxMD Marketplace under publication authority.
- Verify fresh installation from the actual Marketplace listing, activation
  through the documented launcher, and removal of only the wrapper.

The Project Record is `.toolboxmd/project.json`. It indexes this repository's
authoritative files; Marketplace supplies release provenance. Existing
Toolybara promotion for AgentsMD is not assumed to cover this module.

Website impact is narrative: this README, installation documentation and the
Marketplace listing describe the capability and compatibility. No existing
public URLs change. Release assets and the Marketplace catalog are the
authoritative publication state; documentation links to them without treating
a prepared package as a published one.

The X launch follows a usable public installation path. A capability demo must
be distinguished from an efficiency comparison. Any savings claim needs a
comparison that includes accepted output quality, review, retries, elapsed
time and token usage. This implementation provides no savings benchmark.


## Native desktop candidate

The desktop release requires the actual app to launch the exact adapter,
resume an existing conversation with unchanged identity, load the plugin tool,
and complete real work with subsequent requests consuming upward and downward
effort changes. Exercise native app and browser tools with their authorization
intact. Test restart/removal against the same conversation. The local native
provider fixture and isolated app startup are supporting proof, not this
behavioral acceptance. Keep publication and X launch on hold until it passes.

Run desktop acceptance only in a disposable macOS VM or an explicitly isolated
test Mac. A separate `CODEX_HOME` alone does not isolate the desktop's UI state,
IPC and native authorization. Never use a working host's App Server, credentials
or original task data as the candidate test environment.

The native authorization regression additionally requires the unmodified
desktop resources in that isolated environment:

```sh
KNOB_DESKTOP_RESOURCES=/Applications/ChatGPT.app/Contents/Resources \
  node --test test/desktop-authorization.test.mjs
```

This checks the real native peer authorizer against the packaged desktop shim,
a fixture-owned MCP pipe and a loopback provider. It proves authorization at
that seam, not full desktop behavior. The fixture starts its own App Servers
with fresh profiles and an explicit environment; it never attaches to the app.

The desktop integration test retains a pre-existing task, applies upward and
downward effort changes, interrupts a pending provider request, and verifies
exact saved turn IDs, statuses and items across an adapter restart and a
normal native launch without the wrapper. It also completes another turn in
each launch mode. Every fixture owns both its Codex and SQLite directories
and uses file-based credential storage with an unauthenticated loopback
provider. This is native protocol and persistence proof, not desktop GUI or
authenticated Astra acceptance.
