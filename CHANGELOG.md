# Changelog

## 0.4.3 — 2026-11-01

- 按授权计划修复了 evaluation v2 的独立验收边界缺陷：runtime/evaluation-runner.mjs 现在在 command 结束、verify 启动之前再次检查 assessmentFile；若任务适配器已提前写出 assessment，则不运行 verify（避免覆盖证据），该 trial 记为 validity=invalid、verification.outcome=failed（error=assessment-pre-exists，detail 说明 verify 未运行）、invalidReason='Assessment existed before external verification; verify not run'，伪造文件按实际哈希写入回执并原地保留，后续 trial 停止。tests/evaluation.test.mjs 新增回归用例（fixture report trial 的 command 同时写 outputFile 与 taskOutcome=passed 的伪造 assessment，verify 仅为 node -e process.exit(0)），docs/evaluation.md 补充固定执行顺序、该判定与边界。仅为 FCS 公开源码候选编辑；未触碰 Provider/凭据/权限/会话/版本/manifest，未启用 deferred intent routing，未提出性能或科学有效性主张。

## 0.4.2 — 2026-11-01

- 已完成本地候选（未推送、未建 PR、未改清单/版本/凭据），严格限于 runtime/evaluation.mjs、tests/evaluation.test.mjs、docs/evaluation.md、CHANGELOG.md。 完成： - runtime/evaluation.mjs：对 report 集 trial 在 freezeEvaluation/注册阶段强制验收入口在候选项目之外——verify.cwd 必须显式给出且解析后不在项目内；verify.executable 解析后不得在项目内；verify.args 解析到项目内的路径（含相对穿越、不论注册时是否存在）只允许该 trial 自己的 outputFile。开发/选择集、项目外 oracle/assessmentFile、外部目录与标志位参数不受影响。 - tests/evaluation.test.mjs：新增 3 个用例，实际测试 27→30、assert 48→58。负证据：修改前省略 cwd、cwd/executable 在项目内、args 绝对/相对引用项目文件的 5 种 report 形态均被接受；修改后均以明确错误拒绝，且无 experiment/reservation、无输出文件；开发集项目内验收入口仍可注册并实际执行。正例 fixture 仍通过。 - docs/evaluation.md 明确写出实际强制的边界及仍非 OS 沙箱、不证明评分器语义正确；CHANGELOG.md 的 Unreleased 记录缺陷、修复、断言数量与已知未覆盖形态（argv 内联代码、无运行时重定向防护）。 实际验证： - 修复前后复现脚本结果如上；node --test tests/evaluation.test.mjs：30 pass / 0 fail。 - 全仓 node --test runtime/*.test.mjs tests/*.test.mjs：158 tests，156 pass / 2 skip / 0 fail。 - npm run audit、node scripts/verify-links.mjs：通过（35 documents，failures []）。 - 隔离候选副本（排除 .git/.local，同版本依赖）以 verify-manifest --write 重建 116 文件后：npm run verify 退出 0（audit、links、158 tests、manifest 全绿）；npm run verify:sdk 退出 0，modelRequests:0。 剩余/边界：release-manifest.json、版本字段、精确提交 Windows/Linux CI 与 PR/发布由控制器负责，工作树清单未改；已知未覆盖为 verify.args 内联代码/字符串路径不解析、无运行时重定向防护。无本地阻塞。

## 0.4.1 — 2026-11-01

- 在 runtime/autopilot.mjs 中把控制器版本所有权做成单一可复用条款，注入 planner 与 worker 指令，并在独立验证之前（而非之后）就拒绝版本漂移；新增三个测试（提示条款捕获、execute() 前置拒绝的负面证据、assertVersionOwnership 单元比对），并在 docs/superagent.md 增补一条可核对的、明确不作有效性宣称的陈述。未运行任何命令（无 shell），因此不声称测试或 verify/verify:sdk 通过；release-manifest.json 未刷新（不在我可写文件集内）。

## 0.4.0 — 2026-11-01

- Add opt-in frontier source monitoring, versioned observations, original hypothesis research and automatic public-source discovery. The scientist uses the existing fixed model channel and cannot grant itself tools or authority.
- Add a frozen paired artifact benchmark with separate development, selection and held-out cases, independent file-byte grading, retained failures and usage, and a strict limited-adoption rule. Synthetic success is not a claim of broad frontier capability or real-world improvement.
- Expose research progress through the local API and Pi status/evidence commands. Source failures remain visible and ordinary engineering discovery continues when research is idle. Pause and cancellation apply to research as well as development.
- Document research scope, operational limits and the evidence required before adopting architectural changes. Personal model configuration, sessions and deferred intent routing retain their existing boundaries.

## 0.3.10 — 2026-11-01

- 已完成本地候选（仅工作树修改，未提交/推送/建 PR），严格限于 scripts/verify-links.mjs、tests/verify-links.test.mjs、CHANGELOG.md。 完成： - scripts/verify-links.mjs：destination() 现支持目标后的双/单引号标题，以及尖括号目标（保留内部空格、报告时去掉尖括号）；仅当目标/可选标题由本链接的 `)` 正常闭合时才校验，避免把 `[a](see the docs)` 这类散文变成误报；目标内空白、跨行目标、未闭合/多余内容仍返回 null 不抛错，既有输出契约与围栏/行内代码/锚点/编码/嵌套/平衡括号语义不变。 - tests/verify-links.test.mjs：用例 13 → 16。新增双/单引号标题缺失与存在、尖括号含空格目标（不存在报去壳路径、真实存在则通过）、链接状散文不校验且不吞后续真实链接；既有 13 个用例与严格原生路径断言全部保留。 - CHANGELOG.md：Unreleased 记录缺陷、修复、新用例数、未覆盖形态（引用式链接定义、HTML href/src、跨行目标、括号标题）及未声称科学结论。负证据置于围栏代码块，仓库自扫描未新增失败。 验证（本地实际执行）： - node scripts/verify-links.mjs：退出 0，documents 34，failures []。 - node --test tests/verify-links.test.mjs：16 pass / 0 fail。 - 全仓 node --test runtime/*.test.mjs tests/*.test.mjs：120 tests，118 pass / 2 skip / 0 fail。 - node scripts/audit-public.mjs：112 files，0 failures。 - 临时 fixture 复现修复前退出 0、修复后退出 1（failures 严格为去标题/去壳路径），目标真实存在时退出 0；stderr 为空。 剩余：控制器在隔离候选上执行 npm run verify、npm run verify:sdk（modelRequests:0）、用 verify-manifest --write 重建 release-manifest.json、精确提交 Windows/Linux CI 与发布。本地无待办，无阻塞。

## 0.3.9 — 2026-11-01

- 修复 frozen-verify-links 失败：上一轮把徽章式嵌套链接的负证据写成了真实可见的 markdown 链接语法（CHANGELOG.md 中 img.svg×2、present.png），冻结门禁把它当真实链接扫描，导致仓库自身 verify-links 退出 1（failures 3 条，documents 34）。本轮只改 CHANGELOG.md：负证据移入围栏代码块，prose 不再含任何 [...]（...） 形状；代码块示例刻意只用真实存在或 external 目标（LICENSE、package.json、README.md、https://example.com/badge.svg），因此无论门禁是否剥离围栏/行内代码都不会再产生失败；负证据与前置说明仍保留在仓库中（prose 明示 fixture 形状与修复前后 0/1 的期望，可执行证据在 tests/verify-links.test.mjs）。scripts/verify-links.mjs 与 tests/verify-links.test.mjs 未再改动，其深度感知扫描（方括号深度定标签结尾、圆括号平衡定目标结尾、每层各校验一次、未闭合不抛错）与 13 个用例保持上一轮已通过的状态（隔离候选 npm test 117 pass / 0 fail，新脚本对仓库自身 documents 34 / failures []）。未增删任何 .md 文件，documents 基线仍为 34；未改 package.json/依赖、未改 release-manifest.json、未启用意图分流、未触碰凭据/Provider/权限/会话。

## 0.3.8 — 2026-11-01

- 已完成本地候选，未 push / 未建 PR / 未改 release-manifest.json。 完成内容： - scripts/verify-links.mjs：新增锚点收集与片段校验。GitHub 风格 heading slug（小写、空白转 '-'、去标点与强调标记、保留 inline code 与链接文字、重复标题 -1/-2、CJK 保留、冲突避让）；收集显式 id="..." 与 <a name="...">。同文档 #fragment 与跨文档 .md#fragment 均校验，失败为 reason:'missing-anchor'；目标文件不存在仍保持既有 {file,link} 形态；非 .md 目标不校验片段；兼容百分号编码片段。http/https/mailto、围栏/行内代码、undecodable-link、path.relative 原生路径等既有行为不变。 - tests/verify-links.test.mjs：原“片段链接被忽略”用例改写为锚点校验用例（有意行为变更，测试内注释已说明），并新增跨文档片段、slug 归一化（含 CJK/编码）、显式 id/name 锚点用例；保留非 .md 文件不被扫描的断言。 实际验证： - checkout：node scripts/verify-links.mjs 通过，documents 34，failures []；README #getting-started/#documentation 被真实解析；npm run audit 通过；npm test 111 pass / 2 skip / 0 fail；verify-links 测试文件 9/9。 - 精确候选副本用 verify-manifest --write 重建清单后：npm run verify 通过（audit、links、全部测试、manifest 111 files 全绿）；npm run verify:sdk 通过，modelRequests:0。 - README 锚点探针：临时把 “Getting started” 改名后 #getting-started 报 missing-anchor，未改名不报，确认非跳过。 - 现有文档未发现真实断锚，无负证据需要列出。 Remaining：控制器独立校验、按流程重建 release-manifest.json、精确提交 CI 与发布；本地无其他待办。

## 0.3.7 — 2026-11-01

- 为 assess 路径加入有界重试与终态结算。runtime/autopilot.mjs：新增导出的 ASSESS_ATTEMPTS=3 与 assessmentFailure 分类器；assess() 先校验 effect 仍持有的 Eval（stale 立即终止、不调模型），并把『无决定/批覆盖不全/checkedPlan 拒绝』分类为 assessment-invalid 且携带被拒决定摘要（kind/title/files/digest）；tick() 的失败处理改为 fail(kind,effect,error)：assess 前 2 次按现有 settle 退避回到 pending 并记录 {reason,attempt}，第 3 次（或 terminal 错误）进入 rejectAssessment——若该 Eval 仍持有 trigger，则写入显式 ignore 决定（audit.reason=assessment-attempts-exhausted/rejected/attempts/effectId），若已被取代/不可用则只留证据，然后以 settle(effect) 无错结算为 status='done'，因此不再被 claim、不再重复消耗模型调用；launch/input 等其它 effect 的重试语义保持不变。runtime/autopilot.test.mjs：新增两个 fixture 级用例（无效路由决定、瞬时异常），断言 router 恰好 3 次调用、attempts 递增、第 3 次 done、再 tick 不再调用、failure 证据含稳定 reason 与被拒决定摘要、trigger 得到 ignore 决定且可从 list('decision')/disposition/status().effects 观察、未创建 ticket/plan/result、未 publish。本路由无 shell，未运行任何命令；全部可执行验收与冻结检查留待控制器。

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

- 修复 evaluation v2 report 集「独立验收」边界只落实一半的缺口（工程门禁，不构成能力或科学有效性主张）。旧 `freezeEvaluation` 只校验 `plan.verifierFiles` 与 report 集 `oracleFile` 不在候选项目内，而 `trial.verify.cwd` 省略时默认落到候选项目、`verify.executable` 只做哈希绑定、`verify.args` 完全不做路径检查；因此 report 集可以登记一个在候选项目内执行、且可由 worker 在 trial.command 阶段改写的评分器，验收证据可能退化为候选自评。现在在注册/冻结阶段对 report 集 trial 强制：`verify.cwd` 必须显式给出且解析后不在候选项目内；`verify.executable` 解析后不得位于候选项目内；`verify.args` 中解析到候选项目内的路径（含相对路径穿越，且不论注册时是否已存在）只允许该 trial 自己的 outputFile，其余项目内路径被拒绝。开发/选择集 trial、项目外 oracle/assessmentFile、外部目录参数和标志位参数保持原行为。
- 负证据与回归（可执行证据在 tests/evaluation.test.mjs）：修改前同一 fixture 的省略 cwd、cwd 在项目内、executable 在项目内、args 绝对路径引用项目文件、args 相对路径穿越项目文件五种 report 形态均被接受，开发集项目内验收入口也被接受；修改后前五种以及指向注册时尚不存在项目内路径的两种 args 形态均在 `freezeEvaluation` 抛错且不创建 experiment/reservation、不执行命令，开发集形态仍能注册并执行。用例 27→30、`assert` 断言 48→58；实际运行 `node --test tests/evaluation.test.mjs` 30 pass / 0 fail。
- 仍未覆盖（保留）：`verify.args` 中 `-e` 等内联代码或字符串里的路径不被解析和拦截；检查基于参数解析后的路径位置，不做运行时重定向防护；该边界不是 OS 沙箱，也不证明评分器语义正确或评审者独立。
- 本次执行状态与剩余：本地实际运行 `node --test tests/evaluation.test.mjs`（30 pass / 0 fail）、`node scripts/audit-public.mjs`、`node scripts/verify-links.mjs`、`node --test runtime/*.test.mjs tests/*.test.mjs`（158 tests，156 pass / 2 skip / 0 fail）；改动仅限 runtime/evaluation.mjs、tests/evaluation.test.mjs、docs/evaluation.md、CHANGELOG.md。在隔离候选副本（排除 `.git`/`.local`，以同版本依赖链接）中用 `verify-manifest --write` 重建 116 文件后，`npm run verify` 全链通过（audit、links、158 tests、manifest），`npm run verify:sdk` 通过且 modelRequests:0；控制器仍在精确提交上重建 release-manifest.json 并执行最终门禁。本 worker 未改 release-manifest.json、未改版本字段、未推送或建 PR。

- 修复发布门禁 scripts/verify-links.mjs 对「带标题」与「尖括号目标」链接的静默跳过（工程校验缺陷，不涉及研究结论，本轮未声称科学结论，也不改变对外协议）。旧实现的 destination() 在目标内遇到任意空白字符就返回 null，scan() 随后执行 `if(open&&open.value)check(...)` 而跳过该链接：既不校验文件是否存在，也不产生任何 failure。CommonMark 合法的两类真实链接因此对门禁完全隐形：带双/单引号标题的 `[docs](missing.md "Title")`、`[docs](missing.md 'Title')`，以及尖括号包裹的含空格目标 `[docs](<missing dir/x.md>)`。这与上一轮已修复的徽章式嵌套链接外层目标同属一类假阴性：LICENSE、package.json 或任一篇文档被改名/移走时，links 环节仍可能全绿，而该环节是 scripts/release.mjs 在 --apply 前执行的发布前门禁。
- 负证据（保留用例与前置说明）：可执行证据在 tests/verify-links.test.mjs 的三个新增用例——修复前对应 fixture 退出 0 且 failures 为 `[]`，修复后按期望退出 1 并报告去壳/去标题后的目标；目标文件真实存在时同一声明退出 0、failures `[]`。下面的围栏代码块只复述形状，代码块内的链接语法不是链接（verify-links 的既有语义），因此本文件自身不会制造新的门禁失败。

```
修复前，以下三行均被静默跳过（退出 0、failures []）：
[docs](missing.md "Title")
[docs](missing.md 'Title')
[docs](<missing dir/x.md>)

修复后：
[docs](missing.md "Title")          → 退出 1，link 为 missing.md
[docs](missing.md 'Title')          → 退出 1，link 为 missing.md
[docs](<missing dir/x.md>)          → 退出 1，link 为去掉尖括号的 missing dir/x.md
对应文件真实存在时同一声明退出 0、failures []。
反向保护：[a](see the docs) 仍是散文，退出 0、failures []，不会被当成目标校验。
```

- 实现（scripts/verify-links.mjs）：destination() 现在接受以空白分隔的可选双/单引号标题，并在尖括号目标中保留空格、报告时去掉尖括号；只有目标（及可选标题）由本链接的 `)` 正常闭合时才返回构造，因此 `[a](see the docs)` 这类没有定界符标题的散文仍保持旧的「未校验即不报」语义。目标内空白、跨行目标、未闭合标题或标题后多余内容仍返回 null 而非抛错；围栏/行内代码、external/mailto、片段/锚点、编码、Windows 原生路径、徽章嵌套、平衡圆括号等既有语义与 `{passed,documents,failures}` 输出契约不变。
- 测试（tests/verify-links.test.mjs）：用例数由 13 增至 16，新增三个用例——双/单引号标题下缺失目标报告且存在目标通过；尖括号含空格目标按去掉尖括号的真实路径校验（对应文件存在时通过）；无定界符标题的链接状散文保持不校验且不吞掉后续真实链接。既有 13 个用例全部保留，失败断言仍以 path.relative 原生相对路径严格相等，未放宽。
- 仍未覆盖的形态（保留的负证据）：引用式链接定义（`[ref]: path`）、原始 HTML 的 href/src、目标跨行换行；本轮也只处理双/单引号标题，未纳入括号标题。这些形态不在本次范围内，避免一次改动覆盖过多语法而产生误报。
- 执行状态：本 worker 在本地 checkout 实际运行 `node --test tests/verify-links.test.mjs`（16 pass / 0 fail）、全仓 `node --test runtime/*.test.mjs tests/*.test.mjs`（120 tests，118 pass / 2 skip / 0 fail）、`node scripts/audit-public.mjs`（112 files，0 failures）与 `node scripts/verify-links.mjs`（退出 0、documents 34、failures []），并用临时 fixture 复现修复前退出 0、修复后退出 1 及目标存在时退出 0；`npm run verify`、`npm run verify:sdk`（modelRequests:0）以及 Windows/Linux 精确提交 CI 由控制器在隔离候选上执行。改动仅限 scripts/verify-links.mjs、tests/verify-links.test.mjs、CHANGELOG.md；未改 package.json/依赖、未改 release-manifest.json（由控制器用 verify-manifest --write 重建）、未启用意图分流、未触碰凭据/Provider/权限/会话。

- 修复发布门禁 scripts/verify-links.mjs 对「徽章式嵌套链接」外层目标的假阴性（工程校验缺陷，不涉及研究结论，也不改变对外协议）。旧实现用单条正则扫描链接，该正则的标签部分不允许嵌套方括号：对「链接文字本身就是一个内联图片」的徽章写法，它先匹配到内层图片并在内层右括号处结束，剩下的那段以右方括号加圆括号开头、前面已经没有左方括号，因此**外层目标完全不被校验**。README 第 7–9 行三个徽章正是这种形状，其外层相对目标 `package.json`、`LICENSE`（以及 Verify 徽章的外层 workflow URL）都落在这个盲区里：`npm run verify` 的 links 环节会对这一类真实断链给出绿色通过，即使 `LICENSE` 或 `package.json` 被改名/移走也不会报错。这与 0.3.8 已建立的目标（锚点与相对链接必须可验证）直接矛盾。
- 负证据（保留用例与前置说明）：可执行证据在 tests/verify-links.test.mjs 的徽章用例——fixture 用内联图片充当链接文字，内层图片文件存在、外层目标 `missing-outer.md` 不存在（`present.png` 存在）；修复前该 fixture 退出 0 且 failures 为 `[]`，修复后退出 1 且 failures 恰为一条、link 为 `missing-outer.md`、file 为原生相对路径，内层图片不再重复报错。下面的围栏代码块只复述形状，且刻意只用本仓库真实存在或 external 的目标，因为代码块内的链接语法不是链接（这既是 verify-links 的既有语义，也保证本文件自身不会制造新的门禁失败）。

```
旧扫描器（假阴性）：单条正则，标签内不允许嵌套方括号
[![badge](https://example.com/badge.svg)](LICENSE)
[![badge](https://example.com/badge.svg)](package.json)
  顺序：先匹配到内层图片并在内层右括号处结束，剩余的外层片段前面已无左方括号，
  因此上两行的外层目标 LICENSE / package.json 从不被校验：它们被改名或移走，links 环节照样通过。

修复后（方括号/圆括号深度感知扫描）：每一层目标各校验一次，按源码顺序
[![badge](https://example.com/badge.svg)](LICENSE)   内层 external 图片跳过，外层 LICENSE 被真正校验
[docs [beta]](README.md)                            标签内的方括号不提前结束链接文字，目标为 README.md
  目标内的平衡圆括号同样由深度感知处理，带括号的真实文件名可被解析，缺失时报告同形 failure；
  内层图片缺失时仍报告图片缺失（原有图片校验行为保留）。
```

- 实现（scripts/verify-links.mjs）：改为深度感知扫描，不再用单条正则一次性匹配。方括号嵌套深度决定链接文字的结尾（允许跨行；空行终止段落，未闭合的 `[` 不跨段搜索），圆括号平衡深度决定目标的结尾（目标内可含平衡圆括号），标签内的嵌套构造先于外层、按源码顺序各校验一次；反斜杠转义按 CommonMark 视为字面量；未闭合的 `[` 或 `](` 既不抛异常也不产生 stderr 堆栈，扫描继续。输出 schema 仍为 `{passed,documents,failures}`，失败条目形态不变（file 为 path.relative 原生相对路径，link 为原始目标，reason 仍为 `undecodable-link` 或 `missing-anchor`）。围栏（含缩进/引用块）、行内代码、external/mailto、非 .md 片段不校验、undecodable-link、重复标题 -1/-2 等既有语义未变。
- 测试（tests/verify-links.test.mjs）：用例数由 9 增至 13，新增四个用例——徽章式嵌套链接只报外层目标、每一层各校验一次且内层缺失图片仍报、链接文字内嵌套方括号与目标内平衡圆括号、未闭合 `[` 或 `](` 被跳过且后续链接继续扫描；既有 9 个用例的断言强度未降低（期望 file 仍以原生相对路径严格相等，未放宽），围栏/行内代码/片段/锚点/编码/路径分隔符行为全部保留。
- 执行状态：本路由无 shell/网络工具，未运行任何命令；脚本退出码与 documents 数（期望 34，与改动前基线一致）、`npm run verify`、`npm run verify:sdk`（modelRequests:0）以及 Windows/Linux CI 均由控制器在隔离候选上实际确认，未执行前不作为已验证证据。改动仅限 scripts/verify-links.mjs、tests/verify-links.test.mjs、CHANGELOG.md；未改 package.json/依赖、未改 release-manifest.json（由控制器用 verify-manifest --write 重建）、未启用意图分流、未触碰凭据/Provider/权限/会话。
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
