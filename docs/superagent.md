# Super-agent integration and autonomous iteration

FCS includes the MIT-licensed domain core of DeepSeek's `dsh-superagent-prototype`, pinned at `6337fc823ce20251c8de8085948165c81aaa701e`. Original source and license are retained in [vendor](../vendor/dsh-superagent-core/README.md).

There are two execution paths: a native Pi executor and a separately deployed official DSH service. Both can use one FCS controller and one writer lease. The controller owns acceptance and publication; the DSH worker receives a bounded assignment, edits its own checkout, and hands back a candidate. It does not merge its own work. Personal accounts, model selections, credentials, home paths and service receipts stay outside the public repository.

## Domain and durable state

`runtime/superagent.mjs` supplies SQLite repositories and transactional effect/outbox records to the upstream Engine. Triggers are immutable and idempotent; Threads route context to subscribed Tickets; Mandates preserve authorization; Assignments identify replaceable executors. A context subscription grants no new authority. Explicit stops survive follow-ups and restarts. Configuration revisions invalidate stale decisions. Outgoing effects with unknown results require reconciliation rather than blind replay.

The default state root is `~/.pi/fcs-superagent-state`, separate from legacy workflow state. Native status does not create an absent database. Existing workflow records and runtime identifiers are preserved.

## Explicit activation

Installation and reading records do not start a model, poll a remote service or activate a worker. Configure and start an independent service explicitly:

```sh
node runtime/superagent-service.mjs --config <private-config.json> --execute
node runtime/superagent-cli.mjs <project> status
```

The private configuration names `project`, `authorization`, `scope`, `agentDir`, exact `provider` and `model`, `mode`, `cycleMinutes`, `discoverySeconds`, `port`, and optionally `publish`, `repository`, `autoMerge`, `backupRoot`, `coordinationRoot`, `workerEngine` (`pi`, `dsh`, or `alternate`) and the DSH queue/workspace roots. `trustedRoot` holds the separately frozen verifier source. Monetary limits may be absent only when the operator explicitly authorizes uncapped spending. Individual attempts remain bounded for recovery.

The native Pi command `/workflow-superagent` reads status and provides read/ingest/pause/resume/stop operations. `workflow_context` expands existing evidence references without activating execution. A running service watches the durable records. Pausing cancels the current attempt; resuming preserves the original authorization and does not expand it. A `STOP` file in the project state directory holds the service paused across restarts.

The local panel binds to loopback and prioritizes actionable exceptions, active work and accepted results. Mutating API calls require a local request header and reject foreign origins. The official DSH panel is separately configured.

## Autonomous development

An authorized rule can scan repository evidence and propose one bounded improvement. Model roles are fixed, manually configured roles; this does not enable per-turn intent-based model selection.

1. Freeze the task's problem, observable acceptance, original revision and writable files.
2. Acquire the shared writer lease and create a separate branch/worktree.
3. Execute with the Pi file-only worker or the official DSH service. Follow-ups are context; wider work is handed back. Direct filesystem and shell execution by DSH require an appropriate deployment boundary.
4. Run candidate `verify`, isolated `verify:sdk`, and supervisor-held regression tests in a separate fixture. Refresh the manifest through the supervisor's known implementation. Retain failures and bounded repair attempts.
5. Review source and acceptance in a fresh model session. Automated review is fallible and is not a human or scientific validation claim.
6. When configured, `autoVersion` increments the patch version and updates the lockfile and changelog, followed by another verification. `localDeployment` invokes an explicitly configured deployment command (`executable`, `args` with `{candidate}` and `{artifacts}` placeholders). Its receipt must match the reviewed source manifest before publication.
7. When separately authorized, back up the source, push a branch, create a concrete PR, require the exact candidate commit's Verify CI, then merge with the matching head SHA. Ambiguous remote results resume the same validated candidate and reconcile branch, PR and merge state before repeating an effect.
8. `updateAfterMerge` fast-forwards a dedicated, clean source checkout. `autoRelease` waits for the merged commit's Verify CI and creates an immutable version tag with source backups. A deployment supervisor can restart the service from the validated installed code after the ticket settles. These options require the corresponding authorization; they do not change an unrelated working tree.

Source and SDK checks establish the covered engineering behavior. They do not prove productivity, general superiority, model identity at the weights level, or that previously open personal Pi sessions reloaded. Experiments continue to follow [RESEARCH.md](../RESEARCH.md) with separate development, selection and held-out results. Automated source adoption does not promote an untested scientific claim into a persistent lesson.

## Model channel and official DSH deployment

`runtime/model-gateway.mjs` provides a loopback-only, exact-model bridge. It resolves authentication through the existing Pi runtime and does not give DSH the upstream credential. A local stdio relay supports a WSL DSH service using a Windows authentication channel. It forwards the configured model id without fallback; server-reported aliases must be recorded separately from the requested route. Bridge credentials are private deployment data.

Install the pinned official DSH prototype in an independent profile following its deployment documentation. `integrations/dsh-fcs-source` adds the local controller queue through the documented Source interface. Configure that Source's `controller` bot as an inferred candidate and enable only the FCS rule. Keep the queue private. No Feishu account is created or configured by installing this integration.

## Recovery and limitations

One controller owns a shared file set. Different engines use separate checkouts. Service crashes retain pending work and validated candidates; external writes with unknown outcomes are reconciled against the destination before retry. A writer lease can be recovered only after its process on the same platform is confirmed dead. Back up active workflow and configuration before deployment, as required by [maintenance](maintenance.md).

For local Pi deployment, run `node scripts/deploy-superagent.mjs --config <private-deployment.json> --candidate <source> --artifacts <private-receipts> --apply`. The private deployment configuration names `agentDir`, `deployRoot`, `provider` and `model`. The script installs a manifest-addressed source version, loads the actual active extension entry, invokes read-only status, performs an installed model/file-tool probe, and compares personal configuration hashes. It preserves a prior extension wrapper and records whether existing sessions were reloaded. An operator still needs to configure process supervision for persistent unattended service.

File-tool restrictions, queues, worktrees and account wrappers are not an OS sandbox. The supervisor's external tests protect against common self-grading failures, but cannot establish arbitrary semantic correctness or make untrusted candidate code safe to execute. Isolate execution environments according to the actual trust boundary. Keep verifier provenance and source/runtime deployment receipts separate.
