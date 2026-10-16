# Frontier Computing Systems

**FCS · Agent Systems, Harnesses & Evaluation**

Research, build and evaluate AI-native computing systems through real tasks,
reproducible experiments and bounded automation. The formal research program is
**Frontier Computing Systems Research**; the internal identifier is `fcs`.
The Chinese [README](README.md) is the canonical guide.

Renamed from **ZhenZhi Workflow** on 2026-10-16, preserving the repository history.
The current implementation is **FCS Pi Workflow**. The original v0.1.0 release,
runtime identifiers and state paths remain compatible; renaming the project does
not migrate a personal Pi profile. The name describes a research direction, not
a demonstrated claim of frontier capability.

Public v0.1.0 extracted task control, on-demand prompts, reviewed memory,
evaluation and context observability from a private WF6/WF7 deployment.
Personal configuration and private Git history are deliberately absent.

Requires Node >=24.12.0 and Pi 1.2.0. Run `npm ci --ignore-scripts`,
`npm run verify`, and `npm run verify:sdk`. Default tests use isolated fixtures,
make no paid model requests and do not alter the active Pi profile.

Intent routing is deferred. Manual model-role selection remains the baseline.
Installing the package starts no worker, recurring job, classifier or goal.
Task activation and execution are separate, explicit operations.

Start with the [research charter](RESEARCH.md) and [positioning decision](docs/research/fcs-positioning.md).
See [installation](docs/installation.md), [maintenance](docs/maintenance.md),
[architecture](docs/architecture.md), [security](SECURITY.md) and [MIT license](LICENSE).
