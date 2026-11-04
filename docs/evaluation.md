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
| cases | 每个 id/family/split/inputFiles/oracleFile；同一任务族不能跨开发、选择、报告集；不同 split 的用例不能声明相同的输入字节或相同的 oracle 字节，同一 split 内允许复用 |
| verifierFiles | 验收器与其依赖源文件绝对路径；最终报告验收代码和 oracle 位于候选工作项目之外 |
| trials | 每次 id/caseId/arm/repeat/command/verify/outputFile/assessmentFile；每个用例在每个臂上具有相同的预定重复序号 |
| policy | regression 或 paired，以及 minReportTasks（独立任务族数量）；paired 还要求 minDelta/maxMeanWallRatio；可加 maxMeanCostRatio/costUnit |

command 和 verify 均为 `{executable,args,cwd,timeoutMs}`，不经 shell 拼接。执行文件与声明输入会被哈希；每条命令超时最多 600000ms，整体试验额度最多 100 次。budget 中的费用与 Token 只是冻结的实验条件，本离线评估器不调用模型，也不替第三方计费端实施硬额度；实际模型适配器必须另行实施预算。确认阶段不能继续改计划。

冻结期还会按 `bind` 已记录的内容 SHA-256 检查用例输入文件：同一输入字节出现在 development、selection、report 中任意两个不同 split 时，登记在任何事务之前以稳定标识 `Case input files must not repeat across evaluation splits` 失败；`store.read().experiments.<id>` 不产生，该计划的 outputFile 与 assessmentFile 均不创建，command 与 verify 均不执行。比较基准是输入文件的字节哈希，因此不同路径的同字节副本与硬链接同样视为同一输入；同一 split 内的多个用例复用同一输入仍被允许。该检查只覆盖跨 split 的输入字节同一性：同义改写、不同字节但语义相同的材料、注册后替换文件、运行期写入，以及验收器语义与评审者独立性仍未覆盖。保守副作用是：把同一份公共上下文文件（例如公共说明）列入两个不同 split 的用例输入会被拒绝，应改用不同内容，或把相应用例合并到同一 split 的一个用例中。

同一位置（冻结期、任何事务之前）也对用例的 oracleFile 做同一类跨 split 检查：同一 oracle 字节出现在 development、selection、report 中任意两个不同 split 时，以稳定标识 `Case oracle files must not repeat across evaluation splits` 失败，同样不产生 `store.read().experiments.<id>`、不创建该计划任何 trial 的 outputFile 与 assessmentFile、不执行 command 与 verify。依据仍只是 `bind` 已记录的 oracle 内容 SHA-256，因此把 report oracle 的字节复制到项目内的另一路径、做成硬链接或经其它名称引用，都与直接复用同一路径等价（report 用例的 oracle 本身仍必须在候选项目之外，开发/选择用例的 oracle 仍可在项目内）。同一 split 内多个用例共享 oracle 字节仍被允许。这项检查把“共享 oracle”的覆盖从“完全未覆盖”收窄为“仅 oracle↔oracle 字节同一性已覆盖”。仍未覆盖的形态包括：输入↔oracle 的跨类型字节同一性（例如把 oracle 字节同时声明为另一用例的 inputFiles）、同义改写、不同字节但语义相同的材料、注册后替换文件、运行期写入，以及验收器语义与评审者独立性。保守副作用是：两个不同 split 中内容完全相同的平凡 oracle（例如都是 `{}` 或同一份空答案）会被拒绝，应改为不同内容，或把这两个用例合并到同一 split 的一个用例中。这不是 OS 沙箱，不构成独立验收已经完成或科学有效性的证明。

command 是受信任的任务执行适配器，产生 outputFile；verify 是预先审查的外部验收器，只读检查实际产物并产生 assessmentFile；它在验证期间改写或替换 outputFile 会使该 trial 失效。产物快照、验收件与结果回执都只接受普通文件，按 lstat 语义判定：outputFile 与 assessmentFile 的符号链接（即使指向可读的普通文件）、目录与其它特殊文件都不算有效产物或有效验收件，也没有字节哈希；运行期快照与回执复核都要求这两个路径上的普通文件只有一个名字（nlink=1），多链接的普通文件按硬链接冒名拒绝，见下文的运行顺序与汇总复核。所有输出必须尚不存在、彼此唯一且不覆盖冻结输入；父目录先创建。assessmentFile 必须位于候选项目之外。默认不设置 OS 沙箱，不可用此入口执行任意不可信生成代码。正式模型任务须使用真正的隔离环境与网络策略；“外部路径”只是结构边界。

每个 trial 开始前的“输出必须全新”预检与 command 结束后的“assessment 是否预先存在”判定都按 lstat 条目语义，而不是会跟随链接的路径存在性：只要路径条目本身存在——普通文件、目录、特殊文件，或指向不存在目标的悬空符号链接——就算已存在。因此注册后预先放在 outputFile 的悬空链接（无论其目标是否存在）会在 trial 开始前命中既有拒绝，运行以 `Trial outputs must be fresh; inspect before execution` 中止：command 不执行、链接目标不会被创建、不写入 reservation 或回执、后续 trial 不执行，实验记录保持 candidate，汇总保持 ineligible。任务适配器在 command 中留在 assessmentFile 的悬空链接同样算预先存在的 assessment：运行器以稳定标识 `assessment-pre-exists` 拒绝，外部验收器不启动、链接目标不会被创建（因此不会先发生项目外写入再失败关闭），该 trial 记为 `validity=invalid`、`taskOutcome=not-evaluated`、`hardConstraintsPassed=null`、`assessment.sha256=null`，链接原地保留供检查，后续 trial 不执行，实验保持 ineligible。这两处判定只回答“路径条目是否已存在”；条目存在后是否为可读普通文件、链接数与字节哈希仍由后文产物快照的 lstat 规则判定。该谓词只关闭“运行前已经存在的路径条目（含悬空符号链接）”这一形态，不覆盖 verify 运行期自身的重定向与子进程写入、reflink 或同字节单链接复制、写入后再还原、验收器语义正确性与评审者独立性，也不是 OS 沙箱，不构成独立验收已经完成的证明，不改变任何评分或研究结论。

执行顺序固定为 command → 产物快照（是否为普通文件、链接数与其字节哈希）→ assessment 存在性检查 → verify → 产物再观察（是否为普通文件、链接数与其字节哈希）与一致性检查 → assessment 路径类型与链接数检查 → 读取。command 结束后先记录 outputFile 是否为普通文件、链接数及其字节哈希，再检查 assessmentFile 是否已存在。若 command 结束后 outputFile 已存在但不是普通文件（符号链接、目录或其它特殊文件），运行器在启动外部验收器之前就拒绝该 trial：`verification.outcome=failed`，`verification.error` 为稳定标识 `output-not-regular-file`，detail 说明 outputFile 不是普通文件且外部验收器未运行；该 trial 记为 `validity=invalid`、`taskOutcome=not-evaluated`、`hardConstraintsPassed=null`、`output.sha256=null`、`assessment.sha256=null`，链接原地保留供检查，后续 trial 不再执行，实验保持 ineligible。这条拒绝先于 assessment 存在性检查与 verify 执行，因此“把 outputFile 做成指向项目外答案文件的链接、让验收器顺着链接读到答案”的形态不会被执行，验收器也不会顺着该链接写坏项目外文件。同一次快照还记录链接数：若 outputFile 虽是普通文件但链接数大于 1（它有第二个名字，可能是指向项目外 oracle 的硬链接），运行器同样在启动外部验收器之前拒绝，`verification.outcome=failed`，`verification.error` 为稳定标识 `output-hardlink`，detail 写明链接数并说明外部验收器未运行；该 trial 记为 `validity=invalid`、`taskOutcome=not-evaluated`、`hardConstraintsPassed=null`、`output.sha256=null`、`assessment.sha256=null`（被拒绝的路径不作为产物记录字节哈希），链接与目标原地保留供检查，后续 trial 不再执行，实验保持 ineligible。因此“任务适配器把 outputFile 做成指向项目外 oracle 或项目内冻结输入的硬链接、外部验收器按路径读到这些字节并写出 passed”这一形态不会启动验收器：适配器没有真正写出产物的 trial 不会留下 valid/passed 证据，冻结输入的字节也不会因为共享 inode 而在 verify 期间被改写。若任务适配器已自行写出 assessment，运行器不启动 verify（以免覆盖该文件），该 trial 记为 `validity=invalid`、`verification.outcome=failed`，invalidReason 指明 assessment 在外部校验前已存在；该文件按哈希写入回执并原地保留供检查，不会被审核当作有效评分。未预写 assessment 时启动 verify，结束后重新观察 outputFile 是否为普通文件、链接数及其字节哈希。若该路径仍是普通文件但链接数大于 1——verify 期间产物获得了第二个名字，例如被换成指向项目外同字节复制的硬链接——运行器以与 verify 前相同的稳定标识 `output-hardlink` 拒绝：该 trial 记为 `validity=invalid`、`verification.outcome=failed`、`taskOutcome=not-evaluated`、`hardConstraintsPassed=null`，detail 写明实际链接数，并说明外部验收器已经运行、其结果不被接受（不复用 verify 前“外部验收器未运行”的措辞）；`output.sha256=null`（多链接路径不作为产物记录字节哈希），assessment 侧按该路径当时的真实形态记录（单链接普通文件记真实哈希，其它形态为 null，且其内容不被当作本次评分解析），链接与字节原地保留供检查，后续 trial 不再执行，实验保持 ineligible。这条链接数判定先于字节比较：同一路径既获得第二个名字又改写字节时仍记为 `output-hardlink`。若只有字节或“是否为普通文件”与快照不同（单链接普通文件），说明产物在外部验收期间被改写或替换，该 trial 记为 `validity=invalid`、`verification.outcome=failed`，`verification.error` 为稳定标识 `output-modified-during-verification`，invalidReason 与 verification 字段同时保留 verify 前后的产物哈希；产物原地保留并按真实（verify 后）字节哈希写入回执 `output.sha256`，后续 trial 不再执行，实验保持 ineligible，不能被审核当作有效评分。

产物一致性检查之后、读取 assessment 之前，运行器再按 lstat 语义检查 assessmentFile 的路径类型：该路径已存在但不是普通文件（符号链接、目录或其它特殊文件）时，不读取其内容（即使链接指向可读 JSON 也不跟随），`verification.outcome=failed`，`verification.error` 为稳定标识 `assessment-not-regular-file`，detail 说明 assessmentFile 不是普通文件且其内容未被读取；该 trial 记为 `validity=invalid`、`taskOutcome=not-evaluated`、`hardConstraintsPassed=null`、`assessment.sha256=null`，`output.sha256` 仍为 verify 后真实普通产物的哈希，链接或目录原地保留供检查，后续 trial 不再执行，实验保持 ineligible。因此“外部验收器在 verify 期间把 assessmentFile 写成指向项目外（或项目内）可读 JSON 的符号链接、运行器顺着链接读出 passed 评分”的形态在运行期即被稳定拒绝，不会先记为 valid/passed、再在回执复核时以通用错误失败关闭；assessmentFile 不存在时仍走原有通用无效路径。

同一位置也检查链接数：assessmentFile 是普通文件但链接数大于 1 时，verify 已结束（其进程结果保留在 `verification.exitCode` 等字段），但运行器不读取该文件内容，`verification.outcome=failed`，`verification.error` 为稳定标识 `assessment-hardlink`，detail 写明链接数并说明其内容未被读取、未被当作评分解析；该 trial 记为 `validity=invalid`、`taskOutcome=not-evaluated`、`hardConstraintsPassed=null`、`assessment.sha256=null`（被拒绝的路径不作为验收件记录字节哈希），`output.sha256` 仍为 verify 后真实普通产物的哈希，链接与目标字节原地保留供检查，后续 trial 不再执行，实验保持 ineligible、decision 保持 `insufficient-evidence`，审核拒绝。因此“外部验收器把 assessmentFile 做成指向项目外 passed JSON 的硬链接”这一形态不会得到有效评分记录。当 verify 期间的产物链接数判定同时成立时，行只保留一个稳定标识 `output-hardlink`（产物已不是单链接工件，验收器结果本就不被接受），assessment 侧仍按该路径的真实形态记录哈希，因此该行可写入、可复核。

产物再观察与一致性检查使用 verify 启动前后的两份快照，比较字节哈希与“是否为普通文件”，并对 verify 之后的链接数单独判定（该路径是普通文件且 nlink>1 时以 `output-hardlink` 拒绝，先于字节比较）；字节改变仍记为 `output-modified-during-verification` 并按真实（verify 后）单链接字节写入回执。链接数检查只覆盖“某路径当前是普通文件且 nlink>1”这一具体形态，是保守的失败关闭：reflink 与字节相同的单链接复制（nlink 仍为 1）仍与原始文件无法区分。这些检查也不检测“写入后再还原”、注册或记录之后不改变“单链接普通文件”形态的路径掉包（例如用同字节复制替换）、运行期重定向、子进程绕过 node 的其它写入方式、验收器语义正确性或评审者独立性，仍不是 OS 沙箱，也不能证明评分器语义正确。lstat 只回答“该路径当前是否为普通文件、有几个名字”，不回答文件来源或内容真实性；这类检查只排除链接、特殊文件与硬链接冒名形态，不构成独立验收已经完成的证明，也不是科学有效性或能力提升的证据。

report 集在冻结时强制验收入口位于候选工作项目之外：`verify.cwd` 必须给出且解析后不在候选项目内（省略即默认候选项目，因此被拒绝），`verify.executable` 解析后不得位于候选项目内；`verify.args` 中以 `verify.cwd` 为解析基准落入候选项目内的路径（不论注册时是否已存在；存在的路径还会对 realpath 结果重复判定），只允许该 trial 自己的 outputFile，其余项目内路径被拒绝。参数按五种形态检查，基准与例外相同：

1. 整个参数本身，例如 `C:\...\project\grader.cjs` 或 `../project/x.json`；
2. 以 `-` 开头且含 `=` 的参数，取其第一个 `=` 之后的值（`--oracle=<路径>`、`--config=<路径>`）；
3. 参数文本内部：把每个参数按空白、引号（`'`、`"`、反引号）以及 `( ) { } [ ] , ; | & = < >` 等分隔符切成片段，每个片段都按同一规则解析。因此 `-e` 内联代码、JSON 值、单/双引号字符串里写出的项目绝对路径，以及按 `verify.cwd` 解析后落入候选项目的相对穿越（如 `../project/answers.json`）都会被拒绝。
4. 参数文本中的成对引号内容：对每个参数里成对的单引号、双引号、反引号，把引号内整段文本作为一条完整路径按同一规则解析。因此当含空白的上级目录使带引号的项目内绝对路径在空白/引号切分后看似项目外时（例如临时根目录名含空格，参数为 `--oracle="<root>/project/answers.json"`，或 `-e` 代码字符串中的同样路径），仍按整体路径拒绝；项目外路径与该 trial 的 outputFile 例外保持不变。引号配对只按语法成对，不解码转义。
5. 百分号编码：对上述每一种候选片段（整个参数、`--flag=` 后的值、文本片段、引号内整段）再按字节逐层解码，每个片段最多解码 4 层，每一层解码结果都按同一规则、同一 `verify.cwd` 基准和同一 outputFile 例外重新解析。因此 `--oracle=%2F…%2Fproject%2Fanswers.json`（URL 风格包装或内部调用 `decodeURIComponent` 的验收器会把它读成项目内文件）、百分号编码的相对穿越（`..%2Fproject%2Fexpected.json`）、二次编码（`%252F…`）以及 `-e` 内联代码里 `decodeURIComponent('<编码后的项目内路径>')` 的写法，都会在登记期被拒绝。解码按字节进行且不会抛错：不含 `%XX` 的片段原样保留，畸形或截断的转义按原字节保留，所以不会因为无法解码而静默跳过候选。这一层只读取与解码，`plan.trials[].verify.args` 与传入完全一致。

不含 `=` 的标志位（`--strict`）、`--out=<该 trial 的 outputFile>`、`--out=` 加 `encodeURIComponent(该 trial 的 outputFile)`、`command.args` 保持原用法；项目外文件名本身含字面百分号转义的参数（如 `oracle-100%25.json`，解码后仍是项目外路径）同样登记成功。开发/选择集 trial 不受这条入口位置限制；项目外 oracle、assessmentFile、外部目录参数保持原用法。

保守副作用：解码判定只看路径字符串，不要求目标存在，因此某个项目内路径的文件名本身含百分号转义字符（例如名字里带 `%25` 的 outputFile）在解码后可能落到项目内另一个名字上而被拒绝——这类文件改名即可，项目外的百分号转义文件名不受影响。

以下仍属未覆盖形态：比 4 层更深的嵌套编码、`\x`/`\u` 转义、`String.fromCharCode` 或 Buffer 拼接等运行期构造、环境变量或配置文件间接引用；引号内路径与其它文本混排，或跨多个引号、分隔符拼接（如 `path.join('<root>','project','answers.json')`）；注册后才出现的符号链接变化、运行期重定向与子进程写入；验收器程序化遍历目录发现项目内文件。该检查不设置 OS 沙箱，不证明评分器语义正确，也不证明评审者独立；参数文本、引号内容与百分号解码检查只是补齐该路径入口，本身不构成独立验收已经完成的证明。

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

taskOutcome 为 passed/failed；hardConstraintsPassed 是独立硬约束结果；validity 可省略（默认 valid）或明确 invalid；metrics 可省略，省略代表未知，不代表零费用。不得为便于通过填写虚构费用。进程退出 0 但无真实产物/有效验收会标记 invalid；outputFile 或 assessmentFile 不是普通文件（符号链接、目录或特殊文件）同样按无效处理：前者在外部验收器启动前以 `output-not-regular-file` 拒绝且本次不运行验收器，后者在 verify 之后、读取前以 `assessment-not-regular-file` 拒绝且不读取其内容。路径本身是普通文件但链接数大于 1 时同理：outputFile 在外部验收器启动前以 `output-hardlink` 拒绝且本次不运行验收器，assessmentFile 以 `assessment-hardlink` 在 verify 之后、解析前拒绝且不解析其内容；若 outputFile 是 verify 期间才变成多链接普通文件，同样记为 `output-hardlink`，但该行说明外部验收器已经运行、其结果不被接受（两者的 detail 均写明链接数；被拒绝的路径不记录字节哈希，回执中对应 sha 为 null，文件原地保留供检查）。验收进程正常退出但任务结果失败则保留为 valid/failed。模型或工具失败应由适配器保存真实错误产物，再由验收器按预定规则归类，不能任意剔除。由任务适配器提前写出的 assessment 不属于“有效验收”，会被判为 invalid 并停止后续 trial，需人工检查后另行授权新的实验计划。验收器在验证期间改写或替换 outputFile 同样不属于有效验收：字节改变记为 `output-modified-during-verification`，把该路径换成多链接普通文件（即使字节相同）记为 `output-hardlink` 且不为该路径记录字节哈希；两种形态都停止后续 trial，产物原地保留供人工检查。

每次运行先持久化 reservation，随后执行和保存带身份的回执。重复 id、未结算 reservation、未知试验或错误请求摘要会阻止重放；崩溃后不盲目重试。记录 invalid 或未完成的试验不能被审核时静默忽略。当前不自动分配重试；需要重试的模型研究须先将相应槽位和归类规则纳入计划，额外预算变更需另行审查。

## 汇总与审核

汇总及采纳审核重新核对冻结输入、结果回执、任务产物与验收文件。回执里的 output/assessment 按与运行期相同的规则复核：记录后若该路径被换成符号链接或目录（即使目标字节相同），或成为链接数大于 1 的普通文件（例如换成指向同字节副本的硬链接），汇总与审核以稳定的既有错误（`Trial output or assessment changed`）失败关闭，不会继续 eligible；把该路径恢复为链接数为 1 的同字节普通文件后，原回执重新可复核。按设计记录 `sha256=null` 的行（例如 verify 期间产物变为多链接、以 `output-hardlink` 记录的 trial）不适用这条掉包判定：复核只要求该路径此刻不是单链接普通文件，因此该行可以写入并可复核，但汇总仍为 ineligible、decision 仍为 `insufficient-evidence`，不会以通用错误丢掉这行证据。冻结输入的绑定（`artifactHash`/`checkBindings`）仍只按字节计算，备份或去重工具给已声明输入增加第二个名字不会造成假拒绝；新增的链接数要求只作用于 outputFile、assessmentFile 这两条回执路径。以下仍属未覆盖形态：reflink 与字节相同的复制（例如 nlink=1 的同内容掉包）、写入后再还原、注册或记录之后不改变“单链接普通文件”形态的路径变化、运行期重定向与子进程写入、验收器语义正确性与评审者独立性；这条复核同样不构成独立验收已经完成的证明。所有计划项必须完成；未验证的人工字段不获得新版证据地位。旧格式历史仍可查看和拒绝，旧的 reviewed-for-adoption 历史状态不改写，但不能获得新版的 eligible 结论。

- regression：报告集任务全部通过，全部计划试验有效，硬约束不失败；用来保护已经支持的行为。
- paired：报告每臂成功/失败/无效原始计数、全部重复均通过的任务数、平均执行时间与配对成功率差。先按用例重复求平均，再在任务族内聚合，最后等权比较任务族。重复和改写题目不增加独立样本数。
- 当前配对审核采用保守的单侧 95% Hoeffding 下界：`delta - sqrt(2 ln(20) / n)`，截断至 [-1,1]，n 为独立任务族数。要求下界达到预定 minDelta，且时间比不超过预算；启用费用比时要求实测费用及一致单位。未满足时报告 insufficient-evidence，不能解释成候选一定更差。
- 该概率界依赖独立、具有代表性的任务抽样。任务族标签不能证明这一假设；固定便利样本仅支持其范围内的描述。小样本不会因为形式上计算了区间就变成广泛能力证据。复杂设计的配对 bootstrap、分层模型或非劣效分析应另行预注册并独立复核，不能试遍方法挑最好看的结果。

评估入口有任何有效任务失败时返回非零，表示本次存在失败，不等价于比较不可用；paired 允许基线失败并可能满足候选审核条件。自动化调用者必须同时读取 summary。eligible-for-review 也不会自动审核或部署，仍需 reviewer/reason/rollback。

控制器回执来自同一用户下的可信程序，不是密码学签名，也不是抵抗同权限恶意进程的证明。独立验收应让候选不能访问和修改答案/评分器；对重要结论另由未参与候选调优的人复核任务、评分器和结果。完整方法与体验验收见 [评估研究方法](research/evaluation-methods.md)。
