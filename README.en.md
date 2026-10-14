# ZhenZhi Workflow

A versioned and reversible Pi workflow for deliberate agent engineering.
The Chinese [README](README.md) is the canonical guide.

Public v0.1.0 extracts task control, on-demand prompts, reviewed memory,
evaluation and context observability from a private WF6/WF7 deployment.
Personal configuration and private Git history are deliberately absent.

Requires Node >=24.12.0 and Pi 1.2.0. Run `npm ci --ignore-scripts`,
`npm run verify`, and `npm run verify:sdk`. Default tests use isolated fixtures,
make no paid model requests and do not alter the active Pi profile.

Intent routing is deferred. Manual model-role selection remains the baseline.
Installing the package starts no worker, recurring job, classifier or goal.
Task activation and execution are separate, explicit operations.

See [installation](docs/installation.md), [maintenance](docs/maintenance.md),
[architecture](docs/architecture.md), [security](SECURITY.md) and [MIT license](LICENSE).
