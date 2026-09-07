# Minimal desktop design

This records the Algorithm review for Issue #5. The user owns the requirement:
Astra may change only its current task's reasoning effort in the ordinary
desktop, with preserved native tools, user policy and conversation identity.
The user also requires minimal machinery and isolated Rocky testing. Merging
experimental code does not satisfy desktop acceptance or authorize activation.

## Question and delete

The useful operation is one native `turn/settings/update` call with a trusted
thread ID, active turn ID and one of four effort values. Model routing,
delegation policy, history repair, a replacement client, automatic restarts,
persistent services, a settings UI and usage benchmarking are unnecessary for
that operation and remain outside the runtime.

Removed from the candidate:

- App-wide and multi-task activation. The public launcher requires one task ID;
  absent selection disables control. Unrelated desktop traffic still traverses
  the adapter, so this narrows control authority, not transport failure impact.
- A generated per-call ID that had no consumer or deduplication behavior.
- The extra-process fallback for runtimes without `execve`. The signed bundled
  runtime supplies it; unsupported runtimes fail explicitly.
- Runtime overrides on the public shim. It pins the app's bundled Node and
  Codex executables. Direct module invocation retains a test injection point.
- The unused shutdown timer variable; the timer itself remains necessary to
  reap descendants that ignore termination.

## Surviving path and why it exists

| Part | Reason to keep it |
| --- | --- |
| Launcher and signed shim | Reversible opt-in through the existing desktop override; the native authorization regression requires signed ancestry. |
| MCP tool | Makes the operation available in an existing conversation using native caller metadata. The released dynamic-tool path does not support resumed desktop tasks. |
| Private socket and random token | Connects the MCP process to its owning adapter without a public listener or persistent configuration. Permissions and token validation reject unrelated callers. |
| Desktop bridge | Binds requests to the selected active Astra turn and lets explicit user settings take precedence. Correlation preserves native client and callback IDs. |
| Process and stream lifecycle | Bounds input/output, times out uncertain updates, and cleans up only its child process group and socket. Regression tests cover stuck descendants. |
| Published custom-client launcher | Preserves the existing 0.1.1 public interface. It is an alternative entry point, not another running layer in the desktop path. Removing it would break existing users. |
| Regression and native fixtures | Prove the identified policy, identity, authorization and lifecycle seams. They are excluded from the installed package. |

The installed runtime has no third-party dependencies. The adapter never reads
or writes history databases, transcripts or user credentials. It does not
retry an uncertain effort mutation or claim that acceptance proves inference.
Fewer lines alone would not justify removing these boundaries.

## Accelerate and automate last

Use focused policy tests for the narrowed task selection, then the full
package gate and real native fixtures in the disposable Rocky VM. Independent
Luna max review targets the final commit. These are supporting proof; actual
desktop app/browser operations, authenticated Astra completion and history
surviving restart remain separate acceptance gates. Existing CI and explicit
launch commands suffice. No new persistent automation is required.
