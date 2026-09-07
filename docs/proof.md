# Proof and release requirements

The package's deterministic gate is `npm test`. The native seam additionally
requires `KNOB_NATIVE_BINARY=/absolute/path/to/codex npm run test:native` with
Codex 0.153.4. CI runs both gates using the pinned Codex package.

The native test creates a temporary Codex configuration pointing at a loopback
Responses fixture. It supplies deterministic tool calls, observes the real App
Server's subsequent request efforts, and deletes its temporary state afterward.
It neither authenticates to OpenAI nor performs a real Astra inference. This
proves integration semantics, not the model's judgment or general efficiency.

The wrapper correctly keeps `executionVerified: false` in normal tool results.
The native fixture's separate observer supplies execution evidence only for
that test. An accepted update is not evidence that a later inference happened.

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
