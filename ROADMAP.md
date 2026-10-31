# Roadmap

Frontier Computing Systems (FCS) studies agent systems, harnesses and evaluation.
The current implementation is FCS Pi Workflow. See [RESEARCH.md](RESEARCH.md) for
the research scope and evidence requirements; these are priorities, not claims
that new capabilities or experiments are already deployed.

## Stable priorities

1. Preserve recoverable versions and observable acceptance.
2. Measure real task quality, rework, elapsed delivery time and actual cost.
3. Keep context and model roles proportionate to the task.
4. Maintain one writer and explicit authority; preserve ordinary-development autonomy.
5. Improve the TUI without competing footer/editor owners or expensive render-time work.

## Candidate work

- Establish a representative, versioned baseline for the current workflow before claiming improvements.
- Evaluate context recovery, memory promotion and bounded automation with ablations, independent outcomes and quality/cost/time tradeoffs.
- Reproduce selected external findings at a pinned revision before adopting them; publish negative results and limitations when appropriate.
- More representative recovery, context-fidelity and multi-model role evaluations.
- Explicit state archival/migration as ledger limits are approached.
- Tested, user-reviewed integration profiles for optional skills/packages/MCP.
- Stronger process isolation when a justified use case requires it; current policy is not an OS sandbox.

## Deferred

Intent-based model routing, per-turn classifier effort and Laya/Jev runtime adoption.
Research remains available; adoption requires a new decision and current evidence.
Installation enables no self-updater, automatic publishing, automatic PR merging or continuous feedback loop. An explicitly configured [Super-agent controller](docs/superagent.md) can perform authorized autonomous development and publication with fixed model roles, isolated candidates and acceptance gates.
