# 维护、版本与恢复

项目现名 **Frontier Computing Systems（FCS）**，正式研究计划为 **Frontier Computing Systems Research**。仓库和源码目录统一为 `frontier-computing-systems`，内部标识为 `fcs`。当前 Pi 实现称为 FCS Pi Workflow；原名 ZhenZhi Workflow 保留在历史与兼容协议中。

公开版本从 0.1.0 开始。此前私人 WF6/WF7 是来源，不是这个仓库已经公开发布的历史。每个版本由源码提交、SemVer、CHANGELOG、固定 package-lock、完整性清单、验证结果和 tag 界定。

## 一次迭代

维护者于 2026-10-14 明确采用 **本地先更新并验收，再发布正式版本** 的顺序。首轮开源只建立公开项目，没有将公开包迁入活动配置；后续功能优化按以下流程执行。

1. 读取 AGENTS，记录目标、验收与实际授权；保留用户未提交修改。
2. 先备份当前实际使用的本地工作流、受影响配置与状态，记录版本、哈希和恢复路径。私人配置使用私有加密备份，不进入公开源码。
3. 复现或检查行为，在授权范围内完成本地优化、部署和实际验收。源码候选可在项目目录先开发；正式发布前确认优化已在目标本地工作流生效。隔离 SDK 测试不能替代活动配置的运行证据；未重新加载的终端、未验证项和失败须如实记录。
4. 根据已经验收的本地结果整理可复用的公开源码，检查配置差异、许可与隐私；功能和研究结论分开。仅文档、许可或元数据调整无需改变活动配置。
5. 更新版本与 CHANGELOG；若协议不兼容，明确说明状态迁移及回退条件。文件定稿后生成完整性清单，并按影响范围验证。
6. 检查即将公开的 diff 和证据，提交源码并备份全部源码版本，再推送候选。远程 CI 通过后才发布 tag、再次备份；不要提交认证、状态或个人清单。

这个顺序不会扩大模型认证、生产服务、外部通信或计费授权，也不会启用意图分流。发布仍需对应任务的明确授权；不能因为本地试验通过就自动发布。

完整性清单不包含自身，不能自证发布者身份。修改文件后应重新生成；已经发布的 tag 不移动，修复使用新提交和新版本。

## 每版备份

```powershell
node scripts/backup.mjs --destination <外部私有备份目录>
node scripts/backup.mjs --destination <外部私有备份目录> --apply
```

默认只预览。显式执行要求干净且已经提交的工作树，审查全部可达提交，创建全 refs 的 Git bundle、每个提交的 ZIP、SHA-256 和 catalog。源目录之外保存，拒绝将备份混入公开仓库。它备份公开源码和历史，不读取活动 Pi 配置、凭据或会话。维护者私人完整快照应使用单独的加密备份流程。

恢复公开源码时先核对 catalog 的 SHA-256，再在新目录 `git clone <history.bundle> <restore-directory>`，确认 HEAD、tag 和工作树。执行 `npm ci --ignore-scripts` 后重新验证。只确认了 bundle 可读还不等于实际恢复已经成功。

私人快照的 DPAPI 加密恢复依赖原 Windows 用户的解密上下文；迁移机器之前应另外规划经过验证的密钥及备份策略。备份目标在另一个盘符不等于已经有独立异地副本。

## 项目更名与兼容

2026-10-16 的更名沿用同一仓库，不重建历史或移动 `v0.1.0` tag。已发布版本的内容以原提交为准；新名称与研究规范先进入主分支的 Unreleased 记录，不据此宣称运行时升级。

- 后续 clone 使用 [正式仓库](https://github.com/zhenzhis/frontier-computing-systems)。已有 clone 应更新 origin；不要重建旧名称仓库，以免破坏 GitHub 重定向。
- 旧版协议标识 `zhenzhi-workflow-v0.1.0`、默认状态目录 `~/.pi/zhenzhi-workflow-state`、`workflow-*` 命令与资源名称继续保留。更新名称不应造成空账本、重复命令或暗中迁移；真正修改协议时另做迁移与恢复验证。
- 历史备份目录、原始回执、版权与许可证保持原样。维护者已指定的外部私有备份位置继续使用；新目录名不授权重命名备份或活动 Pi 配置。
- 源码包目录更名不等于活动会话已重新加载。若个人配置显式引用旧源码路径，应先核查并在单独授权的部署中修改；本次更名不自动改写个人路径。

GitHub 的重定向行为与例外以 [官方更名说明](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository) 为准。

## 发布入口

`node scripts/release.mjs --backup-dir <目录>` 只展示计划；`--apply` 运行验证、备份、建立版本 tag 并再次备份。发布门禁执行的测试集从 `package.json` 的 `scripts.test` 派生，与 `npm test` 完全一致（`runtime/*.test.mjs` 与 `tests/*.test.mjs`）；遇到其他测试脚本形式（新增目录 glob、显式文件、其他 runner 等）直接报错停止，不会静默少跑测试。`node scripts/release.mjs` 的预览路径只读取 `package.json`，不调用 git 或 gh，因此在非 git 检出中也能运行且不产生任何变更。只有同时给出 `--push` 才推送 tag，且要求候选已推送到远程 main、该精确提交的最新 Verify CI 已成功。这一步需要已认证的 GitHub CLI；应先完成候选备份、推送和 CI，再运行公开 tag 发布。已经存在的 tag 拒绝覆盖。这个入口不部署活动配置、不创建 npm 发布、不合并 PR、不启动自动循环。

推送 tag 与创建 GitHub Release 是两步。`Verify` 工作流在版本 tag 的 Windows 和 Linux 验证均通过后，自动创建正式 GitHub Release 并生成公开变更说明；分支和 PR 验证不会创建 Release。发布 job 只获得仓库内容写权限，核对 tag 对应的提交和包版本，使用 `--verify-tag`，不会补造、移动或覆盖 tag。重跑会保留已经发布的 Release，遇到既有草稿或预发布版本会停止并要求核对。所有已发布稳定版本按 SemVer 比较后选择 Latest，较旧 tag 的迟到任务不会把它降回旧版。Release 创建失败会使工作流失败，保留该 tag，可重跑失败 job；不应移动 tag 来重试。

### 发布阶段标识（诊断）

`--apply` 或 `--push` 被拒绝时，`scripts/release.mjs` 在 stderr 输出一行机器可读 JSON（这些拒绝路径不会输出其他 JSON 记录）：`{"stage":"...","message":"..."}`，保留原来的可读 message，退出码仍为 1。CLI 阶段集合为 `semver`、`backup-destination`、`dirty-tree`、`tag-exists`、`remote-main-mismatch`、`ci-query`、`remote-ci-not-passed`、`audit-public`、`verify-links`、`verify-manifest`、`verify-sdk`、`release-test-set`、`release-tests`、`backup`、`tag-create`、`tag-push`、`git`；无法识别的失败记为 `unexpected`。autopilot 调用发布脚本失败时，把 `releaseStage`、`exitCode`、`logPath` 与有界 `releaseSummary`（最多 2000 字符）写入 failure 账本，完整输出仍只保存在 `release.log`；autopilot 侧另有 `tag-immutable`、`release-command`、`ci-failed`、`ci-timeout` 阶段。CI 轮询区分 `ci-query`（查询本身失败）、`ci-failed`（已完成但结论非 success）和 `ci-timeout`（deadline 前未完成）。

这些标识只用于诊断失败位置：它们不是发布成功的证明，不改变授权、重试次数、tag 不可变、备份要求、版本所有权或任何发布/合并门禁，也不构成独立验收；发布仍以实际门禁输出、tag、备份回执和 CI 结果为准。

基线负证据（提交 `a6a52657bce8fe36f52e9d8d4d568b18c37b69e6` 的 `git archive` 隔离副本，实测）：在干净提交后追加空白使工作树变脏，直接运行基线 `node scripts/release.mjs --apply --backup-dir <dir>`，退出码 1，stdout 为空，stderr 只有 `Release candidate is dirty`，没有 JSON 阶段行。另一个 harness 直接 import 基线 `runtime/autopilot.mjs` 的 `Autopilot`，用临时 git 仓库、成功的假 `gh run list` 响应和 `adopt` 同形 receipt 调用 `release(receipt)`，再把同一错误传给 `fail('launch', effect, error)` 读取 failure 账本；实测抛出与账本都只有 `Formal release requires reconciliation`，`releaseStage`/`exitCode`/`logPath` 均为 null。对应断言见 `tests/release.test.mjs` 的 “the release CLI names a dirty candidate…” 与 `runtime/autopilot.test.mjs` 的 “a failed release child records stage…”；基线未实测的 CI 轮询分支（`ci-query`、`ci-failed`、`ci-timeout`）属于静态推断，未计入上述实测输出。

首次公开或协议变更需要实际恢复演练。依赖升级固定版本与 lockfile；不能凭上游最新版标签宣称性能提升。对影响模型或上下文的配置采用有基线、单变量、独立最终用例的实验，候选失败可以保留研究记录但不默认上线。
