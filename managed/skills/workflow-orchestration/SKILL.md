---
name: workflow-orchestration
description: Choose a proportionate WF7 method for coding, research, review, or task recovery; define bounded model roles and evidence-based escalation without requiring slash commands or changing the user's model and permissions.
---

# ZhenZhi Workflow orchestration policy v0.1.0

Intent routing is deferred. Do not enable classification, automatic model switching or per-turn effort classification from these recommendations.

Use this policy when method selection, model roles or continuity matter. It is advisory: user scope, explicit stage boundaries and actual tool gates take precedence. It does not activate a worker, schedule a loop, register a goal, grant permissions or switch the user's selected model. Small clear requests remain small.

## Choose the method in the current agent

Use the user's objective and the inspected project state, not slash-command names, to choose:

| Situation | Method |
|---|---|
| Clear small edit/question | Execute or answer directly; inspect the relevant behavior and verify proportionately |
| Unknown facts or tradeoffs | Research with primary evidence; distinguish observation from inference; preserve read-only boundaries |
| Complex implementation | Establish acceptance criteria and the smallest useful plan; inspect, implement, verify, repair |
| Existing change to review | Examine the actual diff and behavior; report reproducible findings; only implement if authorized |
| Long task or context handoff | Use one WF7 task record with actual evidence, current scope, budgets, failures and next actions |
| Resuming work | Check live files and authorization against the record; never replay external effects from a summary |

The existing /workflow-* entries are explicit shortcuts to these methods. Reading a template is not the same as invoking a runtime command: use /workflow-task's actual control protocol when durable execution is authorized. Do not launch an extra classifier just to choose a method; do not inject every template or the entire workflow manual into every turn. For uncertain scope, make safe independent progress and ask only what materially changes the result.

## Separate three decisions

1. **Method:** how to investigate, implement, verify or recover. The current agent can select this from evidence.
2. **Model:** which capability/latency/cost tradeoff fits a bounded role. The user's selected model and manual Magpie configuration own this choice; suggest a switch when justified, never fabricate an available model or silently change defaults.
3. **Authority:** what effects are authorized. Classification, confidence, model strength, prior summaries and HTTP success do not grant authority. Keep ordinary development automatic and destructive/unapproved external effects subject to necessary explicit authorization.

## Define roles, then delegate only if authorized and useful

Use one completion owner and one final writer. A helper contract states objective, relevant files/evidence, read/write ownership, acceptance criteria, finite budget and expected structured result. Give helpers the minimum relevant context, not the entire conversation. Parallel writers need independent worktrees and explicit ownership of files, ports, data and running instances; do not assume this policy authorizes spawning agents.

Lightweight models may extract facts, summarize supplied material or make a small independently verifiable change. Strong models handle unclear scope, unknown-cause debugging, multi-file reasoning, architecture, difficult synthesis and final complex review. A different provider of the same base model improves availability but is not independent cognitive review. For current role candidates and limitations, read [references/model-roles.md](references/model-roles.md) only when needed.

## Escalate on evidence, not model confidence

Scope growth, missed acceptance criteria, contradictory sources, tool/image incompatibility or repeated failed reproduction invalidate a lightweight assignment. Preserve the failed attempt and evidence, then recommend a strong-role switch or resolve the missing information. HTTP 200 does not mean code passes. Magpie availability fallback cannot repair semantic failures by itself. Do not blindly repeat side effects after partial output or lost connections.

Preserve model/effort continuity within tool rounds unless capacity, incompatibility or failure requires a change. Reclassify at meaningful task boundaries; avoid per-turn model/effort churn. A routed request may retain a previous lightweight choice under uncertainty: if a strong model is required, explicitly select the strong group rather than assuming a probability guarantees it.

## Attention, recovery and evaluation

Keep objectives, accepted constraints, exact relevant evidence and pending failures prominent. Read source material incrementally; remove redundant tool output, not critical state. At semantic milestones or the existing 192K reminder, record complex-task state before compaction/new session. 192K is a trial attention reminder, not a hard capacity limit or a scientifically proven optimum. Respect the actual endpoint window and reserve output space; a group's maximum window does not guarantee its smallest member can continue.

Candidate lessons require evidence and review before promotion to durable instructions. Optimize successful delivery time, first-pass acceptance, rework, actual cost and context fidelity against a fixed strong-model baseline. Change one variable at a time; separate development, selection and held-out cases. No paid evaluations, recurring execution or self-modification are implicitly authorized by this skill.
