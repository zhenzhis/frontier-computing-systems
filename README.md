# Frontier Computing Systems

**FCS · Agent Systems, Harnesses & Evaluation**

研究、构建并验证 AI 原生计算系统：以真实任务为中心，研究 Agent、Harness、上下文与记忆、工具协作、评测和受控自动化。正式研究计划名为 **Frontier Computing Systems Research**；日常简称 **FCS**，内部短标识 `fcs`。

本项目于 2026-10-16 从 **ZhenZhi Workflow** 更名，延续同一 Git 历史。研究定位与工作方法见 [研究纲领](RESEARCH.md)，命名决策与前沿研究对照见 [本次研究记录](docs/research/fcs-positioning.md)。名称表达研究方向，不代表已经达到前沿研究水平。

可版本管理、可恢复、以实际验收为依据的 Pi 工作流。把日常开发、研究、长任务、记忆和实验放进一个可维护的工程项目，逐步迭代，而不是堆叠越来越长的提示词。

**当前工程实现：FCS Pi Workflow。首个公开版本：0.1.0，发布时名为 ZhenZhi Workflow。** 从私人 WF6/WF7 工作流整理而来；公开版本使用独立历史，不携带个人配置、账号、会话或部署回执。项目更名不重发旧版本，也不隐式迁移活动配置或任务状态。Node 24.12.0+，Pi 1.2.0。Windows PowerShell 7 是可选权限适配器的要求；控制器在 CI 的 Windows/Linux 上验证。

## 能力

- 按需开发、研究、长任务、恢复、复盘和单变量实验提示。
- 持久任务账本：精确 revision、有限预算、文件归属、单写者、显式激活、验收与恢复。
- 候选经验、增量反馈、独立检查与评审；不自动提升候选内容为全局指令。
- 只读状态栏与上下文整理提醒；不调用模型，不改变原生压缩。
- 可选 Windows 命令规范化和上游权限插件整合；普通开发自动执行，危险操作保留必要确认。
- 固定依赖、文件完整性、公开内容审计、版本备份和预览优先的发布流程。

**意图分流暂不采用。** 保留研究路径，手动选择模型职责。安装不启动分类器、后台循环、Goal、子代理或付费任务。

## 开发与验证

```powershell
git clone https://github.com/zhenzhis/frontier-computing-systems.git
cd frontier-computing-systems
npm ci --ignore-scripts
npm run verify
npm run verify:sdk
```

默认测试使用隔离目录与无网络模型运行时。测试通过不代表真实 Provider、订阅额度、长上下文质量或已有终端 UI 已验证。

## 作为 Pi 包使用

先阅读 [安装与隔离试用](docs/installation.md)。包的默认入口只有状态与记录扩展、按需提示/Skill和主题；不接管 footer/editor，也不覆盖模型、Key、MCP或全局 AGENTS。

在已配置好 Provider 的隔离配置目录试用：

```powershell
$env:PI_CODING_AGENT_DIR = Join-Path $env:TEMP 'fcs-pi-trial'
pi install .
pi
# /workflow-status
# /workflow-dev 任务
```

这会写入该隔离目录。首次使用需要在那里自行配置认证；不要向项目复制生产认证。试用后在同一个终端执行 `Remove-Item Env:PI_CODING_AGENT_DIR` 恢复默认路径。采用活动配置之前，先备份并核查插件兼容性。上述安装未由本项目自动执行。

复杂任务入口与 JSON 协议见 [运行手册](runtime/README.md)。工程约束见 [AGENTS.md](AGENTS.md)，架构见 [docs/architecture.md](docs/architecture.md)。

## 版本、备份与维护

每个公开版本由 `package.json`、固定依赖、`release-manifest.json`、Git tag 和验证证据定义。私人历史版本与实际部署仍保存在维护者私有备份中；公开历史不伪装成此前已经发布的 WF6/WF7。

```powershell
# 仅查看备份计划，不写入
node scripts/backup.mjs --destination <你的私有备份目录>
# 确认路径后备份全部 Git refs 与每个提交版本
node scripts/backup.mjs --destination <你的私有备份目录> --apply
```

[维护与发布规范](docs/maintenance.md)说明版本升级、备份、回退和验收。`scripts/release.mjs` 默认只展示计划，显式执行前要求干净已提交状态与备份目标。仓库不会自行定时更新或部署。

研究从 [RESEARCH.md](RESEARCH.md) 开始，已有结论在 [docs/research](docs/research/README.md)，当前路线在 [ROADMAP.md](ROADMAP.md)。贡献请看 [CONTRIBUTING.md](CONTRIBUTING.md)，安全问题请看 [SECURITY.md](SECURITY.md)。MIT；第三方许可与出处见 [NOTICE](NOTICE)。
