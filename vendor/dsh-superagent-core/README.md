# DeepSeek Super-agent domain core

Upstream: <https://github.com/deepseek-ai/dsh-superagent-prototype>

Revision: `6337fc823ce20251c8de8085948165c81aaa701e` (2026-10-31), MIT, DeepSeek Harness Team.

`source/` preserves the original `src/core/` files. `index.mjs` and `index.d.mts` are the unminified portable core, built with upstream's locked tsdown 0.22.14 / rolldown 1.2.7:

```sh
pnpm exec tsdown src/core/index.ts --no-config --format esm --target node24 --out-dir <destination> --no-clean
```

The core implements Triggers, Threads, Mandates, Tickets, Assignments, subscriptions, routing, stops and resume. FCS supplies durable repositories, policy, queues, executors and channels. This does not import the DSH host, its credentials, or its unrestricted execution presets. The separate official DSH service remains an optional deployment. See [FCS integration](../../docs/superagent.md).
