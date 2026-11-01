import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const digest = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => JSON.stringify(value, (_key, item) => item && typeof item === 'object' && !Array.isArray(item)
  ? Object.fromEntries(Object.keys(item).sort().map(key => [key, item[key]])) : item);
const requireValue = (condition, message) => { if (!condition) throw Error(message); };
export const evaluationHash = value => digest(canonical(value));
export const artifactHash = file => fs.existsSync(file) && fs.statSync(file).isFile() ? digest(fs.readFileSync(file)) : null;
const inside = (root, file) => { const relative = path.relative(root, file); return !relative || (!relative.startsWith('..' + path.sep) && relative !== '..' && !path.isAbsolute(relative)); };
const identifier = value => typeof value === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(value);
const finite = value => Number.isFinite(value) && value >= 0;
const fileIdentity = file => process.platform === 'win32' ? file.toLowerCase() : file;

function existing(file) {
  requireValue(typeof file === 'string' && path.isAbsolute(file), 'Evaluation inputs must use absolute paths');
  const resolved = fs.realpathSync(file);
  requireValue(fs.statSync(resolved).isFile(), 'Evaluation input must be a file');
  return resolved;
}
function destination(file) {
  requireValue(typeof file === 'string' && path.isAbsolute(file), 'Evaluation outputs must use absolute paths');
  requireValue(fs.existsSync(path.dirname(file)), 'Create output parent directories before registration');
  return path.join(fs.realpathSync(path.dirname(file)), path.basename(file));
}

// This freezes declared inputs of a trusted harness. It is not an OS sandbox,
// complete dependency discovery, model attestation, or proof of grader semantics.
export function freezeEvaluation(project, plan, maxTrials) {
  plan = structuredClone(plan);
  requireValue(plan?.schemaVersion === 2, 'Evaluation schemaVersion 2 required');
  const bindings = {};
  const bind = file => { const resolved = existing(file); bindings[resolved] = artifactHash(resolved); return resolved; };
  for (const file of ['control.mjs', 'evaluate.mjs', 'evaluation.mjs', 'evaluation-runner.mjs']) bind(path.join(path.dirname(fileURLToPath(import.meta.url)), file));
  for (const field of ['model', 'provider', 'modelVersion', 'reasoning', 'sampling', 'context', 'tools', 'environment', 'budget']) {
    requireValue(plan.condition?.[field] !== undefined && plan.condition[field] !== null, `Frozen condition requires ${field}; mark unavailable values unknown`);
  }
  requireValue(plan.arms?.baseline && plan.arms?.candidate && Object.keys(plan.arms).every(identifier), 'Baseline and candidate arms required');
  const armHashes = {};
  for (const [arm, condition] of Object.entries(plan.arms)) {
    requireValue(Array.isArray(condition.files) && condition.files.length > 0 && condition.config && typeof condition.config === 'object', 'Each arm needs declared input files and configuration');
    condition.files = condition.files.map(bind);
    armHashes[arm] = evaluationHash({ files: Object.fromEntries(condition.files.map(file => [file, bindings[file]])), config: condition.config, shared: plan.condition });
  }
  requireValue(Array.isArray(plan.cases) && plan.cases.length > 0, 'Frozen cases required');
  const cases = new Map(), families = new Map();
  for (const item of plan.cases) {
    requireValue(identifier(item.id) && !cases.has(item.id) && identifier(item.family) && ['development', 'selection', 'report'].includes(item.split), 'Unique cases, task families and valid splits required');
    requireValue(!families.has(item.family) || families.get(item.family) === item.split, 'Task family crosses evaluation splits');
    families.set(item.family, item.split);
    requireValue(Array.isArray(item.inputFiles) && item.inputFiles.length > 0, 'Case input files required');
    item.inputFiles = item.inputFiles.map(bind);
    item.oracleFile = bind(item.oracleFile);
    if (item.split === 'report') requireValue(!inside(project, item.oracleFile), 'Report oracle must be outside worker project');
    cases.set(item.id, item);
  }
  requireValue(Array.isArray(plan.verifierFiles) && plan.verifierFiles.length > 0, 'Declared verifier source files required');
  plan.verifierFiles = plan.verifierFiles.map(bind);
  if (plan.cases.some(item => item.split === 'report')) requireValue(plan.verifierFiles.every(file => !inside(project, file)), 'Report verifier source must be outside worker project');
  requireValue(Array.isArray(plan.trials) && plan.trials.length > 0 && plan.trials.length <= maxTrials, 'Finite frozen trial manifest required');
  const ids = new Set(), cells = new Set(), outputs = new Set();
  for (const trial of plan.trials) {
    requireValue(identifier(trial.id) && !ids.has(trial.id) && cases.has(trial.caseId) && Object.hasOwn(plan.arms, trial.arm) && Number.isInteger(trial.repeat) && trial.repeat >= 1, 'Unique trial id, registered case/arm and positive repeat required');
    ids.add(trial.id);
    const cell = `${trial.caseId}/${trial.arm}/${trial.repeat}`;
    requireValue(!cells.has(cell), 'Duplicate case/arm/repeat'); cells.add(cell);
    for (const key of ['command', 'verify']) {
      const command = trial[key];
      requireValue(command && Array.isArray(command.args) && command.args.every(arg => typeof arg === 'string'), 'Structured runner and verifier commands required');
      command.executable = bind(command.executable);
      command.cwd = fs.realpathSync(command.cwd ?? project);
      requireValue(fs.statSync(command.cwd).isDirectory(), 'Command cwd must be a directory');
      command.timeoutMs ??= 60000;
      requireValue(Number.isFinite(command.timeoutMs) && command.timeoutMs >= 1 && command.timeoutMs <= 600000, 'Bounded command timeout required');
    }
    for (const key of ['outputFile', 'assessmentFile']) {
      trial[key] = destination(trial[key]);
      const identity = fileIdentity(trial[key]);
      requireValue(!outputs.has(identity) && !Object.keys(bindings).some(file => fileIdentity(file) === identity) && !fs.existsSync(trial[key]), 'Trial outputs must be unique, fresh and separate from frozen inputs');
      outputs.add(identity);
    }
    requireValue(!inside(project, trial.assessmentFile), 'Assessment must be outside worker project');
    if (cases.get(trial.caseId).split === 'report') {
      requireValue(!inside(project, trial.verify.cwd), 'Report verifier cwd must be outside worker project');
      requireValue(!inside(project, trial.verify.executable), 'Report verifier executable must be outside worker project');
      const output = fileIdentity(trial.outputFile);
      for (const arg of trial.verify.args) {
        const candidate = path.resolve(trial.verify.cwd, arg);
        const resolved = fs.existsSync(candidate) ? fs.realpathSync(candidate) : candidate;
        requireValue((!inside(project, candidate) && !inside(project, resolved)) || fileIdentity(candidate) === output || fileIdentity(resolved) === output, 'Report verifier args must stay outside worker project except the trial outputFile');
      }
    }
  }
  // Every registered case must be measured in every arm at the same repeats.
  for (const item of plan.cases) {
    const repeats = [...new Set(plan.trials.filter(trial => trial.caseId === item.id).map(trial => trial.repeat))];
    requireValue(repeats.length > 0 && repeats.every(repeat => Object.keys(plan.arms).every(arm => cells.has(`${item.id}/${arm}/${repeat}`))), 'Incomplete paired trial manifest');
  }
  const policy = plan.policy;
  requireValue(['regression', 'paired'].includes(policy?.kind) && Number.isInteger(policy.minReportTasks) && policy.minReportTasks >= (policy.kind === 'paired' ? 2 : 1), 'Explicit regression or paired policy and minimum report tasks required');
  if (policy.kind === 'paired') {
    requireValue(finite(policy.minDelta) && policy.minDelta <= 1 && Number.isFinite(policy.maxMeanWallRatio) && policy.maxMeanWallRatio > 0, 'Paired policy needs minDelta and maxMeanWallRatio');
    if (policy.maxMeanCostRatio !== undefined) requireValue(Number.isFinite(policy.maxMeanCostRatio) && policy.maxMeanCostRatio > 0 && typeof policy.costUnit === 'string' && policy.costUnit.length > 0, 'Cost policy needs a ratio and common unit');
  }
  return { schemaVersion: 2, plan, bindings, armHashes, digest: evaluationHash({ plan, bindings, armHashes }) };
}

export function checkBindings(contract) {
  requireValue(contract.digest === evaluationHash({ plan: contract.plan, bindings: contract.bindings, armHashes: contract.armHashes }), 'Frozen evaluation contract changed');
  for (const [file, expected] of Object.entries(contract.bindings)) requireValue(artifactHash(file) === expected, 'Frozen evaluation input changed or missing');
}

export function readEvaluationReceipt(experiment, reference, storeRoot) {
  const contract = experiment.evaluation;
  requireValue(contract.digest === evaluationHash({ plan: contract.plan, bindings: contract.bindings, armHashes: contract.armHashes }), 'Frozen evaluation contract changed');
  const artifact = existing(reference.artifact);
  requireValue(inside(path.join(storeRoot, 'evaluations'), artifact), 'Receipt must be in controller evaluation directory');
  requireValue(artifactHash(artifact) === reference.artifactHash, 'Evaluation receipt changed or missing');
  const row = JSON.parse(fs.readFileSync(artifact, 'utf8'));
  const trial = contract.plan.trials.find(item => item.id === row.trialId);
  const attempt = experiment.attempts?.find(item => item.trialId === row.trialId);
  requireValue(trial && reference.trialId === row.trialId && attempt?.attemptId === row.attemptId && row.contractHash === contract.digest && row.conditionHash === contract.armHashes[trial.arm] && row.arm === trial.arm && row.caseId === trial.caseId && row.split === contract.plan.cases.find(item => item.id === trial.caseId).split, 'Receipt identity does not match reserved frozen trial');
  requireValue(row.schemaVersion === 2 && ['valid', 'invalid'].includes(row.validity) && ['passed', 'failed', 'not-evaluated'].includes(row.taskOutcome) && (typeof row.hardConstraintsPassed === 'boolean' || (row.validity === 'invalid' && row.hardConstraintsPassed === null)), 'Structured trial validity and task outcome required');
  requireValue(['passed', 'failed'].includes(row.execution?.outcome) && finite(row.execution.wallMs) && (!row.verification || ['passed', 'failed'].includes(row.verification.outcome)), 'Process and task results must be separate');
  for (const [key, expectedPath] of [['output', trial.outputFile], ['assessment', trial.assessmentFile]]) {
    requireValue(row[key]?.path === expectedPath, 'Receipt output identity mismatch');
    requireValue(artifactHash(expectedPath) === row[key].sha256, 'Trial output or assessment changed');
  }
  if (row.validity === 'valid') {
    checkBindings(contract);
    requireValue((row.execution.outcome === 'passed' || row.taskOutcome === 'failed') && row.verification?.outcome === 'passed' && row.output.sha256 && row.assessment.sha256, 'Valid trial needs a consistent execution result, verifier and real artifacts');
    const assessment = JSON.parse(fs.readFileSync(trial.assessmentFile, 'utf8'));
    requireValue(assessment.taskOutcome === row.taskOutcome && assessment.hardConstraintsPassed === row.hardConstraintsPassed && evaluationHash(assessment.metrics ?? null) === evaluationHash(row.metrics), 'Receipt differs from verifier assessment');
  }
  return row;
}

const mean = values => values.reduce((sum, value) => sum + value, 0) / values.length;
export function summarizeEvaluation(experiment, storeRoot) {
  if (experiment.evaluation?.schemaVersion !== 2) return { eligible: false, decision: 'insufficient-evidence', reasons: ['Legacy records are readable but are not version-bound comparative evidence'] };
  const { plan } = experiment.evaluation;
  checkBindings(experiment.evaluation);
  const rows = experiment.runs.map(reference => readEvaluationReceipt(experiment, reference, storeRoot));
  const reasons = [];
  if (rows.length !== plan.trials.length || new Set(rows.map(row => row.trialId)).size !== plan.trials.length) reasons.push('Incomplete frozen trial manifest');
  if (rows.some(row => row.validity !== 'valid')) reasons.push('Invalid trials require investigation, not silent exclusion');
  if (rows.some(row => row.validity === 'valid' && row.hardConstraintsPassed === false)) reasons.push('Hard constraint failure');
  const reportCases = plan.cases.filter(item => item.split === 'report');
  const reportFamilies = [...new Set(reportCases.map(item => item.family))];
  if (reportFamilies.length < plan.policy.minReportTasks) reasons.push('Insufficient independent report task families');
  const arms = {};
  for (const arm of Object.keys(plan.arms)) {
    const armRows = rows.filter(row => row.arm === arm && row.split === 'report');
    const completedCases = reportCases.filter(item => armRows.filter(row => row.caseId === item.id).length === plan.trials.filter(trial => trial.caseId === item.id && trial.arm === arm).length);
    arms[arm] = { trials: armRows.length, passed: armRows.filter(row => row.validity === 'valid' && row.taskOutcome === 'passed').length, failed: armRows.filter(row => row.validity === 'valid' && row.taskOutcome === 'failed').length, invalid: armRows.filter(row => row.validity !== 'valid').length, allRepeatsPassedTasks: completedCases.filter(item => armRows.filter(row => row.caseId === item.id).every(row => row.validity === 'valid' && row.taskOutcome === 'passed')).length, meanWallMs: armRows.length ? mean(armRows.map(row => row.execution.wallMs)) : null };
  }
  let comparison = null;
  if (plan.policy.kind === 'regression') {
    if (rows.some(row => row.split === 'report' && row.taskOutcome !== 'passed')) reasons.push('Regression report checks must all pass');
  } else if (!reasons.length) {
    const deltas = reportFamilies.map(family => mean(reportCases.filter(item => item.family === family).map(item => {
      const success = arm => mean(rows.filter(row => row.caseId === item.id && row.arm === arm).map(row => Number(row.taskOutcome === 'passed')));
      return success('candidate') - success('baseline');
    })));
    // Conservative one-sided 95% Hoeffding bound for independent task-cluster
    // differences in [-1,1]. Repeats do not increase the number of task clusters.
    const delta = mean(deltas), lower95 = Math.max(-1, delta - Math.sqrt(2 * Math.log(20) / deltas.length));
    const wallRatio = arms.candidate.meanWallMs / Math.max(arms.baseline.meanWallMs, 1);
    comparison = { taskClusters: deltas.length, delta, lower95, bound: 'one-sided Hoeffding; assumes independent representative tasks', wallRatio };
    if (lower95 < plan.policy.minDelta) reasons.push('Improvement confidence bound below preregistered threshold');
    if (wallRatio > plan.policy.maxMeanWallRatio) reasons.push('Execution time exceeds preregistered ratio');
    if (plan.policy.maxMeanCostRatio !== undefined) {
      const report = rows.filter(row => row.split === 'report' && ['baseline', 'candidate'].includes(row.arm));
      if (report.some(row => !finite(row.metrics?.cost) || row.metrics.costUnit !== plan.policy.costUnit)) reasons.push('Cost evidence unavailable or units differ');
      else {
        const cost = arm => mean(report.filter(row => row.arm === arm).map(row => row.metrics.cost));
        comparison.costRatio = cost('baseline') === 0 ? (cost('candidate') === 0 ? 1 : Infinity) : cost('candidate') / cost('baseline');
        if (comparison.costRatio > plan.policy.maxMeanCostRatio) reasons.push('Cost exceeds preregistered ratio');
      }
    }
  }
  return { eligible: reasons.length === 0, decision: reasons.length ? 'insufficient-evidence' : 'eligible-for-review', reasons, planned: plan.trials.length, reserved: experiment.attempts?.length ?? 0, recorded: rows.length, arms, comparison, automaticallyAdopted: false };
}
