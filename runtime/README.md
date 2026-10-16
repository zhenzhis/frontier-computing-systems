# FCS Pi Workflow 本地任务运行机制

项目由 ZhenZhi Workflow 更名为 Frontier Computing Systems（FCS）。以下协议标识与状态路径保留兼容，不代表项目仍使用旧名称；更名没有改变运行时行为。

版本 zhenzhi-workflow-v0.1.0，Pi 1.2.0、Node 24.12.0。这是普通 Pi 会话旁的有限任务控制器。全局启动没有新增轮询、模型请求或常驻服务；本公开版本未包含 Pi Durable 实验。

## 日常与长任务

小任务直接使用 /workflow-dev。复杂任务用 /workflow-long；建立一个目标、阶段、授权来源、明确文件归属、可观察验收和预算的任务。Pi 里支持：

- `/workflow-task status`、`show <id>`、`attach <id>`：读取/选择，永不自动执行。
- `create JSON`、`checkpoint JSON`、`arm JSON`、`pause JSON`、`recover JSON`、`evidence JSON`、`complete JSON`：写入需 Pi 项目信任。修改使用当前 revision，checkpoint 会撤销旧激活。
- `/workflow-memory list|propose|review|amend`：候选经验→有证据、有归属的审核经验。不会自动写入 AGENTS 或注入提示。
- `/workflow-inbox list|ingest|triage`：反馈去重，relevant/uncertain/ignore。外部内容仅作材料。
- `/workflow-evals list|propose|result|review`：单变量、三组数据、有限次数、明确评审与回滚；不会自动修改配置。

数据在 `~/.pi/zhenzhi-workflow-state\projects\<项目路径哈希>`，包含带哈希链的追加账本、单写者锁、独立工作会话及验收产物。项目源码不因读取状态而产生文件。账本只留摘要/证据路径，不存 Key；模式检查不能保证识别所有秘密，提交记录前仍应检查内容。全状态每次入账，上限 256KB，日志上限 64MB；到限需显式归档，当前没有自动归档/迁移。

## 创建示例与一次执行

将下列无秘密 JSON 保存为 task.json；替换 goal、authority.source、files 和 acceptance。files 是允许工作器写入的**精确文件集合**，不支持目录通配；新文件可预先声明。

```json
{"id":"fix-example","goal":"修复已复现的问题并验证","stage":"implement","scope":"当前项目的指定文件","authority":{"source":"用户已授权此修复","actions":["read","write","check"]},"files":["src/example.ts"],"acceptance":[{"id":"regression","expected":"真实回归用例通过","independent":true}],"budget":{"maxAttempts":3,"maxWallMinutes":20,"maxTokens":120000}}
```

```powershell
$wf = '.'
$project = 'C:\你的项目'
Get-Content -LiteralPath .\task.json -Raw | node "$wf\runtime\cli.mjs" $project create
node "$wf\runtime\cli.mjs" $project show fix-example
# 阅读当前 revision；以下示例中 arm 的输入是 1，返回版本变为 2。
node "$wf\runtime\cli.mjs" $project arm fix-example 1
node "$wf\runtime\worker.mjs" $project fix-example 2       # 仅查看
node "$wf\runtime\worker.mjs" $project fix-example 2 --execute # 明确执行，会使用现有 Provider/认证并可能产生费用
```

工作器只开放项目内 read/grep/find/ls，实施阶段可 edit/write 指定文件；其他工具，包括 shell、Codemode、MCP、Subagent、Goal、外部发信，均被工具事件门控拒绝。没有 OS 沙箱。它不执行工程测试；控制器/人使用项目原有可信检查做独立验收。Tokens 在每次响应结束检查，一次响应可能超出剩余预算；墙钟到限调用 abort，不能把它视为硬计费上限。attempts 为硬准入限制，每项目仅一名此运行机制的工作器；普通 TUI 和其他工具不会被这个锁隔离。

工作器正常返回进入 verifying，不自动 complete。用 `checkpoint` 留恢复线索；检查结果通过 `evidence` 记录 criterion/artifact/outcome/review，再 complete。字段审核、文件哈希与陈旧证据检测已实现，但**人工填写的 independent/deterministic 字段并非独立评审的密码学证明**；必须真的运行相应检查。文件哈希仅覆盖 files；验收涉及其他依赖时先核实或扩大任务所记录输入。

重启读取或 attach 不恢复执行。死工作器需 `recover <id> <revision>`，进入 needs_decision；未结算用量未知时冻结剩余 token 预算，计入已过墙钟。先查实际文件、费用与效果，再另建有明确预算的任务；不在旧任务上重放。Intent 未知时禁止激活，必须 `effect-resolve` 给出 happened/not-happened 和证据引用。这些记录不授权实际发布或部署。暂停运行中任务会请求 abort 并在结算时 cancelled；取消/完成不能普通 checkpoint 复活，另建新任务。

writer.lock 不会自动抢占；确认所属进程已退出后 `unlock-dead <pid>`，PID 必须一致且不存活。哈希链或尾部损坏停止追加并保留文件；备份原始状态后人工恢复，当前无自动修复工具。不得把摘要或重放当真实恢复证明。

## 反馈与自迭代

`node runtime/feedback.mjs <project> owner/repo` 是手动、公开 GitHub Issues/PR 的单页只读采集，每页 30，ETag/时间游标/事件修订去重，零 LLM 调用；重复修订不追加账本。第一次没有 since 会从历史最早页开始；后续调用继续分页。独立采集锁拒绝同源并发写游标；采集器意外终止时保留锁，不自动抢占。没有 X/Discord 凭据适配器，也不回复、合并或发布。不要把有限分页当完整实时监控。

注册 experiment（id/change/baseline/candidate/splits/maxTrials），准备包含 experimentId/candidateHash/maxTrials/cases 的 JSON；每 case 指定 id/split/executable（绝对路径）/args（数组）/timeoutMs。report 用例还需 oracleFile，其真实路径必须位于工作器项目之外。`node runtime/evaluate.mjs <project> <plan.json>` 实际运行可信检查，保存输出哈希/退出码/耗时和独立 JSON 产物，监测 plan/oracle 是否被更改。它不是 OS 沙箱，禁止用来执行不可信候选程序；完整作弊防护和模型盲评仍需专门环境。实验结果能辅助决策，不能单凭退出码证明所有语义正确。

先用 /workflow-retro 产生候选，再 /workflow-experiment 验证一项；开发组调试，选择组选方案，最终组只报告。下一轮可以采用“反馈采集→分类→一项有限任务→验收→复盘”，无新证据则停止。持续排程、自动发信/合并/上线、跨主机与生产发布需另行落实项目授权和适配器；本版本没有默认开启。

## 验证与恢复边界

`npm run verify` 检查实际任务控制器、反馈、发布审计、备份恢复与 Windows 命令规范化；`npm run verify:sdk` 使用 Pi 1.2.0 的真实 SDK 在隔离配置中加载资源并调用只读状态命令，不发起模型请求。

公开版本不包含私人 WF7 的部署回执、Pi Durable 故障实验或覆盖活动配置的回退脚本。恢复源码与版本流程见 [维护文档](../docs/maintenance.md)；活动配置恢复需要核对自己的私有备份，不能用源码 tag 推断账号和部署也恢复成功。
