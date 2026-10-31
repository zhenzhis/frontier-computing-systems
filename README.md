# Frontier Computing Systems

**Agent systems, harnesses & evaluation.**

[![Verify](https://github.com/zhenzhis/frontier-computing-systems/actions/workflows/verify.yml/badge.svg)](https://github.com/zhenzhis/frontier-computing-systems/actions/workflows/verify.yml)
[![Node.js ≥24.12.0](https://img.shields.io/badge/Node.js-%E2%89%A524.12.0-417e38)](package.json)
[![License: MIT](https://img.shields.io/badge/License-MIT-5271a3)](LICENSE)

[Research](RESEARCH.md) · [Getting started](#getting-started) · [Documentation](#documentation) · [Roadmap](ROADMAP.md)

Frontier Computing Systems (FCS) explores how AI agents can complete real work more reliably through better harnesses, context and memory, tool use, and reproducible evaluation.

The current implementation is **FCS Pi Workflow**: a versioned, recoverable workflow for [Pi](https://github.com/earendil-works/pi), with task records, explicit execution, and checks against actual results. Pi is the starting point for a broader research program.

## Highlights

- **Work on demand.** Prompts for development, research, long tasks, recovery, retrospectives, and experiments.
- **Resume with context.** Persistent task records with revisions, budgets, file ownership, and explicit activation.
- **Review before adoption.** Candidate lessons, feedback triage, and single-variable experiments with separate development, selection, and held-out evaluation sets.
- **Keep the interface light.** Read-only status and context reminders, on-demand resources, and an optional Windows permission adapter.
- **Verify and recover.** Pinned dependencies, integrity manifests, public-content checks, source backups, and release previews.
- **Opt into autonomous iteration.** Native Pi and official DSH executors share durable tasks, scoped ownership, linked evidence and automated acceptance/publication gates. See [Super-agent integration](docs/superagent.md).

Manual model-role selection remains the baseline; [intent-based routing is deferred](docs/research/intent-routing.md). Installation starts no workers, background loops, or model requests.

## Getting started

Requires **Node.js 24.12.0+**. The workflow targets **Pi 1.2.0**; the optional Windows permission adapter also requires **PowerShell 7**.

### Set up and verify

```sh
git clone https://github.com/zhenzhis/frontier-computing-systems.git
cd frontier-computing-systems
npm ci --ignore-scripts
npm run verify
npm run verify:sdk
```

Checks use isolated fixtures and make no model requests. SDK validation checks resource loading and read-only commands; live providers and personal deployments require separate verification.

### Try the Pi workflow

With Pi installed, run from the repository root in PowerShell using a fresh configuration directory:

```powershell
$env:PI_CODING_AGENT_DIR = Join-Path $env:TEMP ('fcs-pi-trial-' + [guid]::NewGuid().ToString('N'))
pi install .
pi
```

Inside Pi:

```text
/workflow-status
/workflow-dev Describe a small task
```

Configure authentication in the trial profile before using a model. After exiting Pi, run `Remove-Item Env:PI_CODING_AGENT_DIR` in the same terminal to restore the default path. See [installation](docs/installation.md) for configuration, permissions, and adoption details.

## Documentation

| Guide | Contents |
| --- | --- |
| [Research charter](RESEARCH.md) | Questions, scope, baselines, and evidence standards |
| [Installation](docs/installation.md) | Isolated trials and optional Windows permissions |
| [Architecture](docs/architecture.md) | Components, execution boundaries, and state |
| [Runtime guide](runtime/README.md) | Task control, recovery, memory, feedback, and evaluation |
| [Research notes](docs/research/README.md) | Investigations and adoption decisions |
| [Maintenance](docs/maintenance.md) | Backups, releases, rollback, and verification |

Supporting guides are currently primarily in Chinese. See the [roadmap](ROADMAP.md) for planned work and the [changelog](CHANGELOG.md) for version history.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for the development workflow and [AGENTS.md](AGENTS.md) for repository agreements. Report security issues according to [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE). Third-party licenses and attribution are listed in [NOTICE](NOTICE).

Originally released as **ZhenZhi Workflow** in v0.1.0. FCS continues that public Git history; legacy runtime identifiers remain compatible. See the [positioning notes](docs/research/fcs-positioning.md) for background.
