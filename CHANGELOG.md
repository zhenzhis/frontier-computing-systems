# Changelog

## 0.3.6 — 2026-11-01

- 已完成本地候选修复（无推送/PR/合并/tag，未改清单、凭据或权限）。 背景：本检出在基线 7bf2680，未包含上一轮候选；我按失败日志中的用例名与行号重建了同一候选，再把 Windows 失败的根因修掉。 改动（仅授权三文件）： 1. tests/verify-links.test.mjs（新建，6 用例）：保留原有用例与断言强度；新增 repoPath=path.join 辅助，把 5 处失败断言的期望 file 从硬编码 'docs/xxx.md' 改为 repoPath('docs','xxx.md')，与脚本 path.relative 的原生分隔符同形。Windows 下实际/期望都是 docs\xxx.md，POSIX 下都是 docs/xxx.md，仍是 deepStrictEqual 严格相等，未放宽。 2. scripts/verify-links.mjs：恢复上一轮候选的围栏（含缩进/引用块）、行内代码剥离与非法百分号转义结构化报告实现；输出 schema 仍为 {passed,documents,failures}。 3. CHANGELOG.md：Unreleased 记录缺陷、测试与 Windows 路径断言修复。 实际运行（Linux, Node 24.22.0）： - node --test tests/verify-links.test.mjs：6/6 通过。 - node scripts/verify-links.mjs：退出 0，passed:true，documents:34（与改动前一致），failures:[]。 - npm run audit：passed，112 files，0 failures。 - npm test：108 tests，106 pass，2 skip（Windows-only parser 用例），0 fail。 - 隔离副本用 scripts/verify-manifest.mjs --write 重生成清单后 npm run verify：退出 0（111 files，manifest 通过）；同一副本 npm run verify:sdk：passed，modelRequests:0。 - 额外用 path.win32 校验 5 处期望：join('docs',x) === relative(root, root\docs\x)，均为 docs\x。 - 本工作树 node scripts/verify-manifest.mjs 仍报 CHANGELOG.md、scripts/verify-links.mjs 漂移及 tests/verify-links.test.mjs 未登记，这是预期的；release-manifest.json 留给控制器重生成。 未运行：真实 Windows 执行（本机 Linux），故 Windows 侧仍需控制器在精确提交 CI 验证；已通过原生分隔符等价性与全部用例静态/动态检查降低风险。

## 0.3.5 — 2026-10-31

- 在 scripts/audit-public.mjs 中把 personal-home 规则从「仅 Windows 盘符形式」扩展为同时覆盖 POSIX 绝对家目录路径（/Users/<name>/ 与 /home/<name>/），并新增 tests/audit-public.test.mjs（6 个测试）。只改动了授权的两个文件；未运行任何命令（本 worker 无 shell/网络工具），所有可执行验收由控制器执行。

## 0.3.4 — 2026-10-31

- 完成。修复了 frozen-regression 失败（tests/release.test.mjs 在非 git 检出中调用 `git tag --list` 崩溃），并把 release 门禁测试集改为从 package.json 派生。改动仅限分配文件：scripts/release.mjs、tests/release.test.mjs（新建，85 行）、docs/maintenance.md。 变更： 1. scripts/release.mjs 按 backup.mjs/verify-manifest.mjs 的「export + argv 守卫」约定重构：新增 `releaseTestFiles(root)`、`releasePlan(root,opts)`、`release(root,opts)`、`releaseArgs(args)`，模块导入不再执行门禁。`releaseTestFiles` 只接受 `node --test runtime/*.test.mjs tests/*.test.mjs` 这一种形状（恰好两个目录、无重复、目录必须存在且至少有一个测试文件），任何其他形状（第三个目录 glob、显式文件、`**`、其他 runner、缺少 scripts.test）都 throw，不再静默少跑。`--apply` 用 `releaseTestFiles(root)` 执行测试，脚本内已无硬编码测试文件名。tag 不可覆盖、backup 顺序、`--push` 的 exact-commit CI 前置检查、`gh` 调用与错误退出语义全部保留。 2. tests/release.test.mjs 5 个用例：(a) 与 runtime/*.test.mjs + tests/*.test.mjs 枚举集完全相等且无重复；(b) 显式断言 autopilot/dsh-executor/superagent 三个曾被跳过的文件在集合内，并断言 release.mjs 源码含 `releaseTestFiles(root)` 且不含硬编码测试路径；(c) fail-closed fixture（第三个目录 glob、显式文件、`**`、空目录、重复目录、无 glob、非 node runner、缺 scripts.test、缺 package.json）；(d) 预览路径用 PATH 指向空目录（git/gh 不可用）跑 `node scripts/release.mjs`，断言 stdout 计划字段精确、stderr 为空、目标目录不存在、临时目录无任何写入、tag 集合不变（非 git 检出时跳过比较而非报错），并断言 `import` 无输出无副作用；(e) semver 拒绝与 push 守卫。 验证（本机 Linux，node 24.22.0）： - `node --test tests/release.test.mjs`：5 pass / 0 fail。 - 验收命令 `node -e "const m=await import('./scripts/release.mjs');console.log(m.releaseTestFiles(process.cwd()).join('\n'))"` 输出 11 个文件 = 当前 npm test 集合（含 runtime/autopilot、runtime/dsh-executor、runtime/superagent 与新增 tests/release.test.mjs）。 - 在 supervisor 同构的非 git 副本（排除 .git/node_modules/.local 等）中复现原失败环境：`node --test tests/release.test.mjs` 5/5 通过，预览退出 0，不写任何文件。 - `npm test`：96 tests、94 pass、0 fail、2 skip（windows-parser 在非 Windows 跳过），42s。 - 在非 git 副本中用 supervisor 的 `verify-manifest.mjs --write` 重生成清单（109 files）后 `npm run verify` 全链通过（audit、links、全部测试、manifest），`npm run verify:sdk` 通过。 - 工作树中 `node scripts/verify-manifest.mjs` 仍报 docs/maintenance.md、scripts/release.mjs 漂移及 tests/release.test.mjs 未登记，这是预期的：release-manifest.json 由 controller 重生成，未在分配文件内，我未修改。 遗留/边界：未推送、未建 PR、未合并、未改凭证或 controller；未改 package.json/lockfile 依赖；未启用 intent routing。frozen-regression 阶段此前失败的直接原因（测试在无 .git 的检出里依赖 `git tag --list`）已消除。

## 0.3.3 — 2026-10-31

- 修复了上一轮 verify 失败的原因：单测把 package.json 当成「不该进入清单」的文件，而 release-manifest.json 的排除集合（验收 3 明确列出）不含 package.json，根清单也确实登记了 package.json，因此失败是测试期望写错，而不是实现方向错。现在 scripts/verify-manifest.mjs 保持「双向校验 + 单一排除集合」的实现（仅补充说明性注释，行为不变），tests/verify-manifest.test.mjs 按正确语义重写：fixture 内 package.json 属于发布输入，写入 3 个文件、未登记时 unlisted 同时包含 beta.txt 与 package.json。

## 0.3.2 — 2026-10-31

- Implemented the authorized local candidate in the prepared FCS checkout; no push, PR, merge, publication or external effects performed. Changes: - runtime/autopilot.mjs: added exported installMergedDependencies(project, {log, signal, run=npm}), which runs `npm ci --ignore-scripts --include=dev --no-audit --no-fund` in the given checkout, returns passed:false with stage 'install' on install failure (including the output tail), and returns a distinct passed:false stage 'dev-dependencies' listing any declared devDependency absent from node_modules after install. Autopilot accepts an injectable install function and, in adopt() after the fast-forward to the merged origin/main commit, persists the candidate receipt with adoptedCommit, installs the active checkout's merged lockfile, records install evidence (stage plus log tail) in the candidate receipt and an evidence record, and only then invokes release(). A failed install throws a non-permanent error that leaves HEAD at the merged commit, creates no local or remote tag, never calls release(), and keeps the merged candidate for a subsequent adopt() retry without replanning or a version change. - runtime/autopilot.test.mjs: added three tests covering (a) exact install arguments, distinct install/dev-dependency failure stages and successful install, (b) ordering proved by an observed reflog fast-forward before the install and install -> release sequence with the install target being the resolved active checkout rather than the candidate worktree, and (c) failed install leaving HEAD at merged, persisting adoptedCommit plus install tail evidence, no tag/release, and a successful retry via adopt(saved) with an unchanged plan and package version. All 12 autopilot tests pass, including existing autonomy, frozen-regression and ambiguous-publication recovery tests. - docs/superagent.md: step 8 now states merged dependencies are installed before release-time checks and that a failed install or missing declared devDependency withholds the tag/release while retaining a retryable merged candidate. - release-manifest.json regenerated with the supervisor's script. Evidence: `node --test runtime/autopilot.test.mjs` 12/12 pass; `npm run verify` passed (audit, links, 86 tests with 2 platform skips, manifest 107 files); `npm run verify:sdk` passed with isolated agent and no model or paid requests. Working tree contains only the three assigned files plus release-manifest.json.

## 0.3.1 — 2026-10-31

- Keep repository discovery idempotent within its revision/time bucket so repeated ticks preserve immutable events and continue draining effects.
- Deliver assigned DSH source changes while discarding worker-generated release hashes; the supervisor remains responsible for regenerating the manifest.

## Unreleased

- 修复发布门禁 scripts/verify-links.mjs 的两处潜在缺陷（仓库当前 CI 通过，未观测到线上回归）：围栏代码块此前只识别顶行反引号围栏，现同时排除列表缩进 0–3 空格与引用块（行首 `>`）内的围栏；行内代码中的示例链接也不再被当作真实链接。相对链接目标含非法百分号转义时，原先未捕获的 URIError 会使门禁以堆栈崩溃退出，现改为结构化失败，failure 带稳定原因 `undecodable-link`；输出仍为 `{passed,documents,failures}` 并以退出码 1 结束。新增 tests/verify-links.test.mjs（6 个测试），通过 `--root` 指向临时 fixture，覆盖围栏、行内代码、外部/mailto/锚点链接、非 .md 文件、缺失相对链接与非法转义的报告；release.mjs 只依赖退出码，行为不变。测试的期望 `file` 值改用 path.join 生成，与 CLI 的 path.relative 输出同形，使严格相等断言在 Windows（反斜杠）与 POSIX 下都成立，未放宽断言语义。改动仅限授权文件；未推送、未创建 PR、未发布。

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
