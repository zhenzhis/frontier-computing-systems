# 实验协议与验收

evaluation v2 是现有实验账本的增量协议。它验证声明的条件和工件是否一致、计划是否完整，以及预先声明的审核条件是否满足。它不证明全部依赖均已声明、受测命令确实只使用某模型、评分器语义正确或评审者具有组织独立性。模型服务不可见版本标记 unknown；不确定性不能用一个哈希消除。

## 开始与体验

```powershell
npm run demo:evaluation
```

此命令建立临时项目与显式隔离状态，运行正确产物、错误近邻、空操作和错身份四种情形。检查临时目录中的实际发票汇总 JSON、外部 oracle、验收 JSON 和结果回执。没有模型调用或真实账号；结果只验证评估机制。演示返回临时路径，保留材料供检查，不自动清理。

`tests/evaluation-fixture.mjs` 给出可运行的注册实例；编写自己的可信任务适配器时可以参考结构，不要把这些合成样例当作 held-out 模型基准。

## 登记与执行

沿用 experiment 的 id/change/baseline/candidate/splits/maxTrials，并添加 evaluation：

| 字段 | 内容 |
|---|---|
| schemaVersion | 2 |
| condition | model/provider/modelVersion/reasoning/sampling/context/tools/environment/budget；必须存在，未知项明确写 unknown |
| arms | 至少 baseline 和 candidate；每臂包含非空 files（实际输入文件绝对路径）与 config；可增加 control 臂 |
| cases | 每个 id/family/split/inputFiles/oracleFile；同一任务族不能跨开发、选择、报告集 |
| verifierFiles | 验收器与其依赖源文件绝对路径；最终报告验收代码和 oracle 位于候选工作项目之外 |
| trials | 每次 id/caseId/arm/repeat/command/verify/outputFile/assessmentFile；每个用例在每个臂上具有相同的预定重复序号 |
| policy | regression 或 paired，以及 minReportTasks（独立任务族数量）；paired 还要求 minDelta/maxMeanWallRatio；可加 maxMeanCostRatio/costUnit |

command 和 verify 均为 `{executable,args,cwd,timeoutMs}`，不经 shell 拼接。执行文件与声明输入会被哈希；每条命令超时最多 600000ms，整体试验额度最多 100 次。budget 中的费用与 Token 只是冻结的实验条件，本离线评估器不调用模型，也不替第三方计费端实施硬额度；实际模型适配器必须另行实施预算。确认阶段不能继续改计划。

command 是受信任的任务执行适配器，产生 outputFile；verify 是预先审查的外部验收器，检查实际产物并产生 assessmentFile。所有输出必须尚不存在、彼此唯一且不覆盖冻结输入；父目录先创建。assessmentFile 必须位于候选项目之外。默认不设置 OS 沙箱，不可用此入口执行任意不可信生成代码。正式模型任务须使用真正的隔离环境与网络策略；“外部路径”只是结构边界。

登记后从返回的 `evaluation.digest` 写出 request.json：

```json
{"schemaVersion":2,"experimentId":"example","evaluationDigest":"<登记返回的摘要>"}
```

```powershell
Get-Content -Raw registration.json | node runtime/cli.mjs <project> experiment
node runtime/evaluate.mjs <project> <request.json>
node runtime/cli.mjs <project> evaluation-summary example
```

CLI 默认使用用户状态；上述最后一行仅适用于在默认状态注册的实验。需要隔离状态时通过 ProjectStore 的 stateRoot 注册、运行和读取，参考演示；不要把不同 stateRoot 的记录当同一个实验。Pi 命令也沿用自身部署的默认状态路径。

验收器的 assessment 格式：

```json
{"taskOutcome":"passed","hardConstraintsPassed":true,"validity":"valid","metrics":{"cost":0.12,"costUnit":"USD","tokens":5000,"interventions":0}}
```

taskOutcome 为 passed/failed；hardConstraintsPassed 是独立硬约束结果；validity 可省略（默认 valid）或明确 invalid；metrics 可省略，省略代表未知，不代表零费用。不得为便于通过填写虚构费用。进程退出 0 但无真实产物/有效验收会标记 invalid；验收进程正常退出但任务结果失败则保留为 valid/failed。模型或工具失败应由适配器保存真实错误产物，再由验收器按预定规则归类，不能任意剔除。

每次运行先持久化 reservation，随后执行和保存带身份的回执。重复 id、未结算 reservation、未知试验或错误请求摘要会阻止重放；崩溃后不盲目重试。记录 invalid 或未完成的试验不能被审核时静默忽略。当前不自动分配重试；需要重试的模型研究须先将相应槽位和归类规则纳入计划，额外预算变更需另行审查。

## 汇总与审核

汇总及采纳审核重新核对冻结输入、结果回执、任务产物与验收文件。所有计划项必须完成；未验证的人工字段不获得新版证据地位。旧格式历史仍可查看和拒绝，旧的 reviewed-for-adoption 历史状态不改写，但不能获得新版的 eligible 结论。

- regression：报告集任务全部通过，全部计划试验有效，硬约束不失败；用来保护已经支持的行为。
- paired：报告每臂成功/失败/无效原始计数、全部重复均通过的任务数、平均执行时间与配对成功率差。先按用例重复求平均，再在任务族内聚合，最后等权比较任务族。重复和改写题目不增加独立样本数。
- 当前配对审核采用保守的单侧 95% Hoeffding 下界：`delta - sqrt(2 ln(20) / n)`，截断至 [-1,1]，n 为独立任务族数。要求下界达到预定 minDelta，且时间比不超过预算；启用费用比时要求实测费用及一致单位。未满足时报告 insufficient-evidence，不能解释成候选一定更差。
- 该概率界依赖独立、具有代表性的任务抽样。任务族标签不能证明这一假设；固定便利样本仅支持其范围内的描述。小样本不会因为形式上计算了区间就变成广泛能力证据。复杂设计的配对 bootstrap、分层模型或非劣效分析应另行预注册并独立复核，不能试遍方法挑最好看的结果。

评估入口有任何有效任务失败时返回非零，表示本次存在失败，不等价于比较不可用；paired 允许基线失败并可能满足候选审核条件。自动化调用者必须同时读取 summary。eligible-for-review 也不会自动审核或部署，仍需 reviewer/reason/rollback。

控制器回执来自同一用户下的可信程序，不是密码学签名，也不是抵抗同权限恶意进程的证明。独立验收应让候选不能访问和修改答案/评分器；对重要结论另由未参与候选调优的人复核任务、评分器和结果。完整方法与体验验收见 [评估研究方法](research/evaluation-methods.md)。
