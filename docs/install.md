# Isolated installation

Use Node.js 22 or later and a verified Codex App Server executable. Version
0.153.4 is tested. Existing account access stays with Codex; this package does
not copy or provision credentials.

## Direct package

Open [the release page](https://github.com/toolboxmd/codex-thinking-knob/releases)
and choose an exact version. Download its `toolboxmd-codex-thinking-knob-VERSION.tgz`
and `SHA256SUMS` assets into an empty directory. Verify the checksum before
extracting the package. For version 0.1.1:

```sh
shasum -a 256 -c SHA256SUMS
mkdir -p ./thinking-knob-install
tar -xzf toolboxmd-codex-thinking-knob-0.1.1.tgz -C ./thinking-knob-install
node ./thinking-knob-install/package/bin/codex-thinking-knob.mjs --version
```

The checksum command is available on macOS and common Linux installations;
`sha256sum -c SHA256SUMS` is the GNU alternative. Stop if verification fails.
The archive contains only this module. Keep the downloaded checksum and exact
version for later verification.

Use the absolute extracted `package/bin/codex-thinking-knob.mjs` path in your
client's launch configuration, with `node` as the command and `--adaptive` as
an argument. Your client's configuration syntax is client-specific. A typical
command/arguments representation is:

```json
{
  "command": "node",
  "args": [
    "/absolute/path/to/thinking-knob-install/package/bin/codex-thinking-knob.mjs",
    "--adaptive",
    "--",
    "/absolute/path/to/codex",
    "--enable",
    "step_model_switching",
    "app-server"
  ]
}
```

This is the launch process specification, not a claim that every client uses
these JSON keys. Preserve your client's ordinary App Server arguments.

No npm registry publication is required. The package is marked private to
prevent accidental registry publication. For local development, `npm pack
--ignore-scripts` builds a package from a checkout; that local build is distinct
from the published immutable release artifact.

## ToolboxMD Marketplace

Check that `codex-thinking-knob` appears in the
[ToolboxMD Marketplace catalog](https://github.com/toolboxmd/marketplace) first.
Once listed, install just this package:

```sh
codex plugin marketplace add toolboxmd/marketplace
codex plugin add codex-thinking-knob@toolboxmd
```

Registering the Marketplace makes the suite discoverable; selecting this
package installs only Thinking Knob. A release asset may be available before
the Marketplace listing. Use direct package installation during that interval.

The package includes a setup skill that can resolve its installed root and help
configure a compatible client. Use the installed package's absolute launcher
path. Cache locations can change after an update: resolve and recheck the path
when updating. Plugin installation and launcher activation are separate steps.
This wrapper cannot attach to an existing desktop task. Start a new connection from a client
that supports a configurable App Server launch command.

## Confirm activation

1. Check the wrapper version and the actual Codex executable version.
2. Launch a fresh client connection through the wrapper with `--adaptive`.
3. Start an explicitly selected Astra task. Leave the turn's effort unset when
   requesting adaptive control; explicit effort is treated as a fixed choice.
4. Observe the tool invocation and its native acknowledgement. Actual execution
   requires separate request-level evidence; the acknowledgement alone is not
   sufficient.

## Remove only this module

Stop the client connection and restore its prior App Server launch command.
For direct extraction, remove only the dedicated extraction directory after
checking that it still contains only this package. For Marketplace installation,
run `codex plugin remove codex-thinking-knob@toolboxmd`. Keep the Marketplace
registered if you want continued discovery of other modules.

Existing Codex installation, credentials, tasks, global instructions and other
plugins are outside the wrapper's install and removal footprint.
