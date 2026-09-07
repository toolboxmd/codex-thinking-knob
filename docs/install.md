# Isolated installation

Use Node.js 22 or later and a verified Codex App Server executable. Version
0.153.4 is tested. Existing account access stays with Codex; this package does
not copy or provision credentials.

## Direct package

For the current implementation candidate, build the package from its checkout:

```sh
npm pack --ignore-scripts
```

The resulting `toolboxmd-codex-thinking-knob-0.1.0.tgz` contains only this
module. Extract it into a dedicated location you own:

```sh
mkdir -p ./thinking-knob-install
tar -xzf toolboxmd-codex-thinking-knob-0.1.0.tgz -C ./thinking-knob-install
node ./thinking-knob-install/package/bin/codex-thinking-knob.mjs --version
```

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

After release, use the immutable artifact and checksum attached to that exact
release. No npm registry publication is required. The current package is marked
private to prevent accidental registry publication.

## ToolboxMD Marketplace

Once the wrapper release has been listed, the intended CLI installation is:

```sh
codex plugin marketplace add toolboxmd/marketplace
codex plugin add codex-thinking-knob@toolboxmd
```

These commands describe the publication target. They will not install this
unpublished candidate from ToolboxMD today. Registering the Marketplace makes
the suite discoverable; selecting this package installs only Thinking Knob.

The package includes a setup skill that can resolve its installed root and help
configure a compatible client. Use the installed package's absolute launcher
path. Cache locations can change after an update: resolve and recheck the path
when updating. Plugin installation and launcher activation are separate steps.

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
uninstall this package through the native plugin manager. Keep the Marketplace
registered if you want continued discovery of other modules.

Existing Codex installation, credentials, tasks, global instructions and other
plugins are outside the wrapper's install and removal footprint.
