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

command 是受信任的任务执行适配器，产生 outputFile；verify 是预先审查的外部验收器，只读检查实际产物并产生 assessmentFile；它在验证期间改写或替换 outputFile 会使该 trial 失效。产物快照、验收件与结果回执都只接受普通文件，按 lstat 语义判定：outputFile 与 assessmentFile 的符号链接（即使指向可读的普通文件）、目录与其它特殊文件都不算有效产物或有效验收件，也没有字节哈希，见下文的运行顺序。所有输出必须尚不存在、彼此唯一且不覆盖冻结输入；父目录先创建。assessmentFile 必须位于候选项目之外。默认不设置 OS 沙箱，不可用此入口执行任意不可信生成代码。正式模型任务须使用真正的隔离环境与网络策略；“外部路径”只是结构边界。

执行顺序固定为 command → 产物快照 → assessment 存在性检查 → verify → 产物一致性检查 → assessment 路径类型检查与读取：command 结束后先记录 outputFile 是否为普通文件及其字节哈希，再检查 assessmentFile 是否已存在。若 command 结束后 outputFile 已存在但不是普通文件（符号链接、目录或其它特殊文件），运行器在启动外部验收器之前就拒绝该 trial：`verification.outcome=failed`，`verification.error` 为稳定标识 `output-not-regular-file`，detail 说明 outputFile 不是普通文件且外部验收器未运行；该 trial 记为 `validity=invalid`、`taskOutcome=not-evaluated`、`hardConstraintsPassed=null`、`output.sha256=null`、`assessment.sha256=null`，链接原地保留供检查，后续 trial 不再执行，实验保持 ineligible。这条拒绝先于 assessment 存在性检查与 verify 执行，因此“把 outputFile 做成指向项目外答案文件的链接、让验收器顺着链接读到答案”的形态不会被执行，验收器也不会顺着该链接写坏项目外文件。若任务适配器已自行写出 assessment，运行器不启动 verify（以免覆盖该文件），该 trial 记为 `validity=invalid`、`verification.outcome=failed`，invalidReason 指明 assessment 在外部校验前已存在；该文件按哈希写入回执并原地保留供检查，不会被审核当作有效评分。未预写 assessment 时启动 verify，结束后重新记录 outputFile 的普通文件状态与哈希；若与快照不同，说明产物在外部验收期间被改写或替换，该 trial 记为 `validity=invalid`、`verification.outcome=failed`，`verification.error` 为稳定标识 `output-modified-during-verification`，invalidReason 与 verification 字段同时保留 verify 前后的产物哈希；产物原地保留并按真实（verify 后）字节哈希写入回执 `output.sha256`，后续 trial 不再执行，实验保持 ineligible，不能被审核当作有效评分。

产物一致性检查之后、读取 assessment 之前，运行器再按 lstat 语义检查 assessmentFile 的路径类型：该路径已存在但不是普通文件（符号链接、目录或其它特殊文件）时，不读取其内容（即使链接指向可读 JSON 也不跟随），`verification.outcome=failed`，`verification.error` 为稳定标识 `assessment-not-regular-file`，detail 说明 assessmentFile 不是普通文件且其内容未被读取；该 trial 记为 `validity=invalid`、`taskOutcome=not-evaluated`、`hardConstraintsPassed=null`、`assessment.sha256=null`，`output.sha256` 仍为 verify 后真实普通产物的哈希，链接或目录原地保留供检查，后续 trial 不再执行，实验保持 ineligible。因此“外部验收器在 verify 期间把 assessmentFile 写成指向项目外（或项目内）可读 JSON 的符号链接、运行器顺着链接读出 passed 评分”的形态在运行期即被稳定拒绝，不会先记为 valid/passed、再在回执复核时以通用错误失败关闭；assessmentFile 不存在时仍走原有通用无效路径。

产物一致性检查只比较 verify 启动前后的文件字节与是否为普通文件。这些检查不检测“写入后再还原”、hardlink/reflink 与字节相同的复制、注册后才发生的链接变化、运行期重定向、子进程绕过 node 的其它写入方式、验收器语义正确性或评审者独立性，仍不是 OS 沙箱，也不能证明评分器语义正确。普通文件判定只回答“该路径本身当前是否为普通文件”，不回答文件来源或内容真实性：hardlink、reflink 与同内容复制在字节和路径类型上都与原文件一致，无法据此识别；这类检查只排除链接与特殊文件形态，不构成独立验收已经完成的证明。

report 集在冻结时强制验收入口位于候选工作项目之外：`verify.cwd` 必须给出且解析后不在候选项目内（省略即默认候选项目，因此被拒绝），`verify.executable` 解析后不得位于候选项目内；`verify.args` 中以 `verify.cwd` 为解析基准落入候选项目内的路径（不论注册时是否已存在；存在的路径还会对 realpath 结果重复判定），只允许该 trial 自己的 outputFile，其余项目内路径被拒绝。参数按四种形态检查，基准与例外相同：

1. 整个参数本身，例如 `C:\...\project\grader.cjs` 或 `../project/x.json`；
2. 以 `-` 开头且含 `=` 的参数，取其第一个 `=` 之后的值（`--oracle=<路径>`、`--config=<路径>`）；
3. 参数文本内部：把每个参数按空白、引号（`'`、`"`、反引号）以及 `( ) { } [ ] , ; | & = < >` 等分隔符切成片段，每个片段都按同一规则解析。因此 `-e` 内联代码、JSON 值、单/双引号字符串里写出的项目绝对路径，以及按 `verify.cwd` 解析后落入候选项目的相对穿越（如 `../project/answers.json`）都会被拒绝。
4. 参数文本中的成对引号内容：对每个参数里成对的单引号、双引号、反引号，把引号内整段文本作为一条完整路径按同一规则解析。因此当含空白的上级目录使带引号的项目内绝对路径在空白/引号切分后看似项目外时（例如临时根目录名含空格，参数为 `--oracle="<root>/project/answers.json"`，或 `-e` 代码字符串中的同样路径），仍按整体路径拒绝；项目外路径与该 trial 的 outputFile 例外保持不变。引号配对只按语法成对，不解码转义。

不含 `=` 的标志位（`--strict`）、`--out=<该 trial 的 outputFile>`、`command.args` 保持原用法。开发/选择集 trial 不受这条入口位置限制；项目外 oracle、assessmentFile、外部目录参数保持原用法。以下仍属未覆盖形态：编码或转义后才成形的路径（百分号编码、`\x`/`\u` 转义、`String.fromCharCode` 或 Buffer 拼接等运行期构造）；引号内路径与其它文本混排，或跨多个引号、分隔符拼接（如 `path.join('<root>','project','answers.json')`）；环境变量、配置文件或其它间接引用；注册后才出现的符号链接变化、运行期重定向与子进程写入；验收器程序化遍历目录发现项目内文件。该检查不设置 OS 沙箱，不证明评分器语义正确，也不证明评审者独立；参数文本与引号内容检查只是补齐该路径入口，本身不构成独立验收已经完成的证明。

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

taskOutcome 为 passed/failed；hardConstraintsPassed 是独立硬约束结果；validity 可省略（默认 valid）或明确 invalid；metrics 可省略，省略代表未知，不代表零费用。不得为便于通过填写虚构费用。进程退出 0 但无真实产物/有效验收会标记 invalid；outputFile 或 assessmentFile 不是普通文件（符号链接、目录或特殊文件）同样按无效处理：前者在外部验收器启动前以 `output-not-regular-file` 拒绝且本次不运行验收器，后者在 verify 之后、读取前以 `assessment-not-regular-file` 拒绝且不读取其内容。验收进程正常退出但任务结果失败则保留为 valid/failed。模型或工具失败应由适配器保存真实错误产物，再由验收器按预定规则归类，不能任意剔除。由任务适配器提前写出的 assessment 不属于“有效验收”，会被判为 invalid 并停止后续 trial，需人工检查后另行授权新的实验计划。验收器在验证期间改写或替换 outputFile 同样不属于有效验收：该 trial 记为 invalid 并停止后续 trial，产物原地保留供人工检查。

每次运行先持久化 reservation，随后执行和保存带身份的回执。重复 id、未结算 reservation、未知试验或错误请求摘要会阻止重放；崩溃后不盲目重试。记录 invalid 或未完成的试验不能被审核时静默忽略。当前不自动分配重试；需要重试的模型研究须先将相应槽位和归类规则纳入计划，额外预算变更需另行审查。

## 汇总与审核

汇总及采纳审核重新核对冻结输入、结果回执、任务产物与验收文件。回执里的 output/assessment 也按 lstat 语义复核：记录后若 outputFile 被换成符号链接（即使目标字节相同），`artifactHash` 返回 null，与回执 `sha256` 不一致，汇总与审核以稳定错误（`Trial output or assessment changed`）失败关闭，不会继续 eligible；把原普通文件按原字节恢复后仍可用原回执复核。注册后才发生的链接变化、hardlink/reflink/同内容复制、验收器语义正确性与评审者独立性仍未覆盖，这条复核同样不构成独立验收已经完成的证明。所有计划项必须完成；未验证的人工字段不获得新版证据地位。旧格式历史仍可查看和拒绝，旧的 reviewed-for-adoption 历史状态不改写，但不能获得新版的 eligible 结论。

- regression：报告集任务全部通过，全部计划试验有效，硬约束不失败；用来保护已经支持的行为。
- paired：报告每臂成功/失败/无效原始计数、全部重复均通过的任务数、平均执行时间与配对成功率差。先按用例重复求平均，再在任务族内聚合，最后等权比较任务族。重复和改写题目不增加独立样本数。
- 当前配对审核采用保守的单侧 95% Hoeffding 下界：`delta - sqrt(2 ln(20) / n)`，截断至 [-1,1]，n 为独立任务族数。要求下界达到预定 minDelta，且时间比不超过预算；启用费用比时要求实测费用及一致单位。未满足时报告 insufficient-evidence，不能解释成候选一定更差。
- 该概率界依赖独立、具有代表性的任务抽样。任务族标签不能证明这一假设；固定便利样本仅支持其范围内的描述。小样本不会因为形式上计算了区间就变成广泛能力证据。复杂设计的配对 bootstrap、分层模型或非劣效分析应另行预注册并独立复核，不能试遍方法挑最好看的结果。

评估入口有任何有效任务失败时返回非零，表示本次存在失败，不等价于比较不可用；paired 允许基线失败并可能满足候选审核条件。自动化调用者必须同时读取 summary。eligible-for-review 也不会自动审核或部署，仍需 reviewer/reason/rollback。

控制器回执来自同一用户下的可信程序，不是密码学签名，也不是抵抗同权限恶意进程的证明。独立验收应让候选不能访问和修改答案/评分器；对重要结论另由未参与候选调优的人复核任务、评分器和结果。完整方法与体验验收见 [评估研究方法](research/evaluation-methods.md)。
