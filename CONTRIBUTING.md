# Contributing

Describe the concrete problem, accepted behavior and reproducible evidence.
Keep one change focused; do not introduce a new harness merely because it is popular.

For code changes run `npm run verify` and `npm run verify:sdk`. Tests use isolated
fixtures; keep credentials, subscription metadata and personal paths out of examples.
Record limitations and update docs/changelog when behavior changes.

Before a release update package version/lock and the release manifest, commit a
clean candidate, back up every version, verify the backup, then create an immutable
tag. Keep archived receipts intact. State-schema changes need an explicit migration
and recovery plan; do not silently rewrite existing ledgers.

Pull requests must explain validation and material risks. CI success is necessary
evidence, not permission to merge or proof of real-provider behavior.
