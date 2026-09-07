# Runtime contract

One launcher owns one stdio App Server process. The runtime depends only on
Node.js built-ins and the caller's Codex executable. Transport messages use
newline-delimited JSON. Invalid JSON terminates the connection with a diagnostic
on stderr. No log files, global configuration or background service are created.

## Opt-in and ownership

Without `--adaptive`, parsed messages pass through without effort interception.
With it, the default child command enables `step_model_switching` for that
process. An explicit command after `--` remains unchanged and must enable the
feature itself. The client initialization opts into `experimentalApi`; an
explicit `false` is rejected with a clear error.

Only an explicit `thread/start` selecting `gpt-6-astra`, followed by a successful
response confirming that model, establishes tool ownership. Existing tools
remain registered. A collision with the reserved tool name rejects that start.
The wrapper leaves inherited developer instructions untouched; selection
guidance lives in the dynamic tool description.

`turn/start` and `turn/started` establish the matching active turn. Completion
removes it. Tool requests may arrive before the start response, so notification
ordering is accounted for. Callers cannot supply arbitrary task or turn IDs in
tool arguments; those identifiers come from App Server's callback envelope.

## User settings and conservative boundaries

Explicit client effort settings, collaboration mode, client setting updates,
interruption, model rerouting, resume and fork invalidate or block adaptive
ownership. Explicit overrides may persist as native defaults, so the wrapper
does not silently reenable adaptive control on later turns. Start a fresh,
explicitly selected Astra task to reestablish it.

Unknown resumed tasks remain unowned even when a persisted tool has the same
name. Their callbacks pass through to the client. The current version requires
a fresh task for adaptive use; it does not add the tool to existing tasks.

Non-Astra models and unconfirmed default-model starts receive no injected tool.
Natural-language fixed-effort requests are enforced by the model-facing policy;
the wrapper can independently enforce only the structured client settings it
observes. It does not interpret arbitrary conversation text.

## Tool result

The tool accepts `effort` in `low`, `medium`, `high`, `max` and an optional
`reason` of up to 500 characters. It sends only `effort`, `threadId` and `turnId`
to native `turn/settings/update`.

- `applied`: native publication succeeded. `executionVerified: false` explicitly
  preserves the boundary between acknowledgement and observed execution.
- `targetUnavailable`: no matching eligible live turn, or the native target
  has ended. The tool returns failure.
- `invalidArguments`: unsupported values, extra fields or malformed arguments.
- `nativeError`: the native error is returned without a success claim.
- `timeout`: the native outcome is unknown. The timeout does not roll back or
  cancel a possibly accepted native update. A late response is discarded.

The default native update timeout is 10 seconds. `--timeout-ms` accepts 1 to
120000 milliseconds. An update can affect only subsequent settings captures
within its turn. It does not alter captured inference, child sessions or future
thread defaults.

## Protocol and lifecycle

Adaptive mode maps client request IDs into a private sequence and restores
original IDs in replies. Server requests and their replies retain their own
directional IDs. Internal update replies never leak to the client. Unrelated
notifications and callbacks are forwarded.

The launcher propagates child failure, handles EOF and signals, clears update
timers, and terminates its owned child on shutdown. Backpressure pauses inputs;
excessive queued output closes the bridge with a diagnostic instead of growing
the queue indefinitely.

## Evidence

The real Codex 0.153.4 integration test observes changed outgoing request
effort using a deterministic local provider. Ordinary runtime results cannot
make that observation. The schema and native test establish compatibility for
this exact experimental runtime; neither establishes future-version support
or measured Astra efficiency.
