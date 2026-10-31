# Changelog

## 0.3.3 — 2026-10-31

- 修复了上一轮 verify 失败的原因：单测把 package.json 当成「不该进入清单」的文件，而 release-manifest.json 的排除集合（验收 3 明确列出）不含 package.json，根清单也确实登记了 package.json，因此失败是测试期望写错，而不是实现方向错。现在 scripts/verify-manifest.mjs 保持「双向校验 + 单一排除集合」的实现（仅补充说明性注释，行为不变），tests/verify-manifest.test.mjs 按正确语义重写：fixture 内 package.json 属于发布输入，写入 3 个文件、未登记时 unlisted 同时包含 beta.txt 与 package.json。

## 0.3.2 — 2026-10-31

- Implemented the authorized local candidate in the prepared FCS checkout; no push, PR, merge, publication or external effects performed. Changes: - runtime/autopilot.mjs: added exported installMergedDependencies(project, {log, signal, run=npm}), which runs `npm ci --ignore-scripts --include=dev --no-audit --no-fund` in the given checkout, returns passed:false with stage 'install' on install failure (including the output tail), and returns a distinct passed:false stage 'dev-dependencies' listing any declared devDependency absent from node_modules after install. Autopilot accepts an injectable install function and, in adopt() after the fast-forward to the merged origin/main commit, persists the candidate receipt with adoptedCommit, installs the active checkout's merged lockfile, records install evidence (stage plus log tail) in the candidate receipt and an evidence record, and only then invokes release(). A failed install throws a non-permanent error that leaves HEAD at the merged commit, creates no local or remote tag, never calls release(), and keeps the merged candidate for a subsequent adopt() retry without replanning or a version change. - runtime/autopilot.test.mjs: added three tests covering (a) exact install arguments, distinct install/dev-dependency failure stages and successful install, (b) ordering proved by an observed reflog fast-forward before the install and install -> release sequence with the install target being the resolved active checkout rather than the candidate worktree, and (c) failed install leaving HEAD at merged, persisting adoptedCommit plus install tail evidence, no tag/release, and a successful retry via adopt(saved) with an unchanged plan and package version. All 12 autopilot tests pass, including existing autonomy, frozen-regression and ambiguous-publication recovery tests. - docs/superagent.md: step 8 now states merged dependencies are installed before release-time checks and that a failed install or missing declared devDependency withholds the tag/release while retaining a retryable merged candidate. - release-manifest.json regenerated with the supervisor's script. Evidence: `node --test runtime/autopilot.test.mjs` 12/12 pass; `npm run verify` passed (audit, links, 86 tests with 2 platform skips, manifest 107 files); `npm run verify:sdk` passed with isolated agent and no model or paid requests. Working tree contains only the three assigned files plus release-manifest.json.

## 0.3.1 — 2026-10-31

- Keep repository discovery idempotent within its revision/time bucket so repeated ticks preserve immutable events and continue draining effects.
- Deliver assigned DSH source changes while discarding worker-generated release hashes; the supervisor remains responsible for regenerating the manifest.

## Unreleased

## 0.3.0 — 2026-10-31

- Integrate DeepSeek's pinned MIT domain core with native durable SQLite repositories, immutable events, subscriptions, mandates, assignment recovery and transactional effects.
- Add an explicitly activated autonomous controller, file-scoped Pi workers, a local attention panel, linked evidence retrieval, frozen regression checks, fresh automated review and separately authorized exact-commit GitHub publication/merge.
- Add an official DSH Source adapter, isolated-checkout handoff and a loopback/stdio exact-model bridge that keeps upstream credentials in the existing authentication channel.
- Preserve legacy state paths and runtime identifiers. Installation starts no worker; intent-based model selection remains deferred. Fixture and SDK checks do not establish model productivity or human preference improvements.

## 0.2.0 — 2026-10-17

- Add evaluation v2 with frozen source/configuration/verifier/task identities, paired trial manifests, durable reservations, artifact revalidation and separate process/task/validity outcomes.
- Keep legacy experiment records readable; require version-bound evidence for new adoption reviews. Separate strict regression gates from conservative paired-performance review with task-family uncertainty and optional measured-cost limits.
- Add offline adversarial and end-to-end evaluation fixtures, a runnable acceptance walkthrough, contemporary evaluation research and a maintainer UX acceptance form. No model-performance or human-preference improvement is claimed from fixtures.

- Compatibility: retain existing state paths, runtime identifiers and historical records. Legacy evaluation records remain readable but cannot support new adoption reviews; new reviews require evaluation v2 evidence. Existing reviewed history is not rewritten.

- Rename the project to Frontier Computing Systems (FCS), with the formal research program Frontier Computing Systems Research and repository/package identity `frontier-computing-systems`.
- Add a research charter, a proportionate investigation template and a source-based positioning decision; retain manual model-role selection and deferred intent routing.
- Record the maintainer's local-first deployment/release order. This identity and documentation change does not migrate the active Pi profile, change legacy state identifiers or rewrite the original v0.1.0 release.

## 0.1.0 — 2026-10-14

- First public source release extracted from privately versioned WF6/WF7.
- Portable controller, records, worker policy, prompts, method-selection skill and calm theme.
- Explicit intent-routing deferral and retained research conclusions.
- Exact dependency locks, public-content audit, native Pi SDK loading check, Windows/Linux CI.
- Backup-all-versions and preview-first release tools; private history remains private.
- No active personal profile migration or automatic model/permission changes.
