# 维护、版本与恢复

公开版本从 0.1.0 开始。此前私人 WF6/WF7 是来源，不是这个仓库已经公开发布的历史。每个版本由源码提交、SemVer、CHANGELOG、固定 package-lock、完整性清单、验证结果和 tag 界定。

## 一次迭代

1. 读取 AGENTS，记录目标、验收与实际授权；保留用户未提交修改。
2. 复现或检查行为，完成必要修改与相应测试；功能和研究结论分开。
3. 更新版本与 CHANGELOG；若协议不兼容，明确说明状态迁移及回退条件。
4. 文件定稿后运行 `node scripts/verify-manifest.mjs --write`，再 `npm run verify` 和 `npm run verify:sdk`。
5. 检查即将公开的 diff、测试证据和许可，提交源码；不要提交模型认证、状态或个人清单。
6. 备份已提交版本，再推送；远程 CI 通过后再发布 tag。不得用本地通过替代远程 CI。

完整性清单不包含自身，不能自证发布者身份。修改文件后应重新生成；已经发布的 tag 不移动，修复使用新提交和新版本。

## 每版备份

```powershell
node scripts/backup.mjs --destination <外部私有备份目录>
node scripts/backup.mjs --destination <外部私有备份目录> --apply
```

默认只预览。显式执行要求干净且已经提交的工作树，审查全部可达提交，创建全 refs 的 Git bundle、每个提交的 ZIP、SHA-256 和 catalog。源目录之外保存，拒绝将备份混入公开仓库。它备份公开源码和历史，不读取活动 Pi 配置、凭据或会话。维护者私人完整快照应使用单独的加密备份流程。

恢复公开源码时先核对 catalog 的 SHA-256，再在新目录 `git clone <history.bundle> <restore-directory>`，确认 HEAD、tag 和工作树。执行 `npm ci --ignore-scripts` 后重新验证。只确认了 bundle 可读还不等于实际恢复已经成功。

私人快照的 DPAPI 加密恢复依赖原 Windows 用户的解密上下文；迁移机器之前应另外规划经过验证的密钥及备份策略。备份目标在另一个盘符不等于已经有独立异地副本。

## 发布入口

`node scripts/release.mjs --backup-dir <目录>` 只展示计划；`--apply` 运行验证、备份、建立版本 tag 并再次备份。只有同时给出 `--push` 才推送 tag，且要求候选已推送到远程 main、该精确提交的最新 Verify CI 已成功。这一步需要已认证的 GitHub CLI；应先完成候选备份、推送和 CI，再运行公开 tag 发布。已经存在的 tag 拒绝覆盖。这个入口不部署活动配置、不创建 npm 发布、不合并 PR、不启动自动循环。

首次公开或协议变更需要实际恢复演练。依赖升级固定版本与 lockfile；不能凭上游最新版标签宣称性能提升。对影响模型或上下文的配置采用有基线、单变量、独立最终用例的实验，候选失败可以保留研究记录但不默认上线。
