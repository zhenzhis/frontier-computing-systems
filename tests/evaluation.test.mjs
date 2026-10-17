import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluationFixture } from './evaluation-fixture.mjs';
import { artifactHash, evaluationHash } from '../runtime/evaluation.mjs';

test('v2 end-to-end: actual artifact, external grader, summary, reopen and explicit review', async () => {
  const f = await evaluationFixture(); f.register(); const run = f.run(); assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout); assert.equal(result.runs.length, 2); assert.equal(result.summary.eligible, true);
  assert.equal(result.automaticallyAdopted, false); assert.equal(f.store.read().experiments.fixture.status, 'candidate');
  assert.equal(result.runs[0].execution.outcome, 'passed'); assert.equal(result.runs[0].taskOutcome, 'passed');
  assert.equal(f.review().status, 'reviewed-for-adoption');
});
test('legacy results remain readable but cannot support new adoption', async () => {
  const f = await evaluationFixture(); const input = { ...f.registration }; delete input.evaluation;
  f.store.proposeExperiment(input); f.store.experimentResult('fixture', { caseId: 'unregistered', split: 'report', candidateHash: 'unbound', artifact: 'missing.json', correct: true });
  assert.equal(f.store.evaluationSummary('fixture').eligible, false); assert.throws(f.review, /Legacy/);
});
test('missing condition and missing declared arm files are refused', async () => {
  const f = await evaluationFixture(); delete f.registration.evaluation.condition.modelVersion; assert.throws(f.register, /modelVersion/);
  f.registration.evaluation.condition.modelVersion = 'unknown'; f.registration.evaluation.arms.candidate.files = []; assert.throws(f.register, /input files/);
});
test('frozen request identity and caller command overrides are refused before execution', async () => {
  const f = await evaluationFixture(); f.register(); const request = JSON.parse(fs.readFileSync(f.requestFile));
  fs.writeFileSync(f.requestFile, JSON.stringify({ ...request, evaluationDigest: 'wrong' })); assert.equal(f.run().status, 1);
  fs.writeFileSync(f.requestFile, JSON.stringify({ ...request, candidateHash: 'asserted-label' })); assert.equal(f.run().status, 1);
  assert.equal(f.store.read().experiments.fixture.attempts.length, 0);
});
test('v2 cannot be downgraded to the legacy process-only execution path', async () => {
  const f = await evaluationFixture(); f.register(); const trial = f.registration.evaluation.trials[0];
  fs.writeFileSync(f.requestFile, JSON.stringify({ experimentId: 'fixture', candidateHash: 'unbound', maxTrials: 1, cases: [{ id: 'one', split: 'report', oracleFile: f.registration.evaluation.cases[0].oracleFile, ...trial.command }] }));
  const run = f.run(); assert.equal(run.status, 1); assert.match(run.stderr, /version-bound/); assert.equal(fs.existsSync(trial.outputFile), false); assert.equal(f.store.read().experiments.fixture.attempts.length, 0);
});
test('output paths cannot alias other outputs or frozen inputs', async () => {
  const f = await evaluationFixture(); const trials = f.registration.evaluation.trials, original = trials[1].outputFile;
  trials[1].outputFile = process.platform === 'win32' ? trials[0].outputFile.toUpperCase() : trials[0].outputFile;
  assert.throws(f.register, /unique/); trials[1].outputFile = original;
  trials[0].outputFile = f.registration.evaluation.arms.candidate.files[0]; assert.throws(f.register, /unique/);
});
for (const target of ['candidate', 'oracle', 'verifier', 'input']) test(`declared ${target} drift blocks admission`, async () => {
  const f = await evaluationFixture(); f.register();
  const file = target === 'candidate' ? f.registration.evaluation.arms.candidate.files[0] : target === 'oracle' ? f.registration.evaluation.cases[0].oracleFile : target === 'verifier' ? f.grader : f.registration.evaluation.cases[0].inputFiles[0];
  fs.appendFileSync(file, '\n'); assert.equal(f.run().status, 1); assert.equal(f.store.read().experiments.fixture.attempts.length, 0);
});
test('case family leakage across splits and incomplete arm manifest are refused', async () => {
  const f = await evaluationFixture({ nCases: 2 }); f.registration.evaluation.cases[1].family = f.registration.evaluation.cases[0].family; f.registration.evaluation.cases[1].split = 'selection'; assert.throws(f.register, /crosses/);
  f.registration.evaluation.cases[1].family = 'other'; f.registration.evaluation.trials.pop(); assert.throws(f.register, /Incomplete paired/);
});
test('duplicate trial ids and duplicate case/arm/repeat cells are refused', async () => {
  const f = await evaluationFixture(); const trials = f.registration.evaluation.trials; trials[1].id = trials[0].id; assert.throws(f.register, /Unique trial/);
  trials[1].id = 'unique'; trials[1].arm = 'baseline'; assert.throws(f.register, /Duplicate case/);
});
test('project-local final oracle or verifier source is refused', async () => {
  const f = await evaluationFixture(); const plan = f.registration.evaluation; const original = plan.cases[0].oracleFile;
  plan.cases[0].oracleFile = plan.cases[0].inputFiles[0]; assert.throws(f.register, /outside worker/);
  plan.cases[0].oracleFile = original; plan.verifierFiles = plan.cases[0].inputFiles; assert.throws(f.register, /outside worker/);
});
test('unknown, repeated, and unresolved trial reservations cannot replay', async () => {
  const f = await evaluationFixture(); f.register(); const ids = f.registration.evaluation.trials.map(trial => trial.id);
  assert.throws(() => f.store.beginEvaluation('fixture', 'unknown'), /Unknown/);
  f.store.beginEvaluation('fixture', ids[0]); assert.throws(() => f.store.beginEvaluation('fixture', ids[0]), /reserved/);
  assert.throws(() => f.store.beginEvaluation('fixture', ids[1]), /Unsettled/); assert.throws(f.review, /Incomplete/);
});
test('v2 refuses nonexistent or forged result references and does not consume result slots', async () => {
  const f = await evaluationFixture(); f.register();
  assert.throws(() => f.store.experimentResult('fixture', { trialId: 'unknown', artifact: path.join(f.root, 'missing.json'), artifactHash: 'invented' }));
  assert.equal(f.store.read().experiments.fixture.runs.length, 0);
});
test('process exit zero without output or semantic assessment is invalid', async () => {
  const f = await evaluationFixture(); for (const trial of f.registration.evaluation.trials) { trial.command.args = ['-e', 'process.exit(0)']; trial.verify.args = ['-e', 'process.exit(0)']; }
  f.register(); const run = f.run(); assert.equal(run.status, 1); const result = JSON.parse(run.stdout);
  assert.equal(result.runs[0].execution.outcome, 'passed'); assert.equal(result.runs[0].validity, 'invalid'); assert.equal(result.runs[0].taskOutcome, 'not-evaluated'); assert.throws(f.review);
  assert.equal(result.runs[0].hardConstraintsPassed, null); assert(!result.summary.reasons.includes('Hard constraint failure'));
});
test('valid semantic failure is retained despite process and grader success', async () => {
  const f = await evaluationFixture({ candidatePass: false }); f.register(); const run = f.run(); assert.equal(run.status, 1);
  const row = JSON.parse(run.stdout).runs.find(row => row.arm === 'candidate'); assert.equal(row.execution.outcome, 'passed'); assert.equal(row.verification.outcome, 'passed'); assert.equal(row.validity, 'valid'); assert.equal(row.taskOutcome, 'failed'); assert.throws(f.review, /Regression/);
});
test('duplicate receipt and tampered receipt/output/assessment cannot be reviewed', async () => {
  const f = await evaluationFixture(); f.registration.maxTrials = 3; f.register(); assert.equal(f.run().status, 0); const reference = f.store.read().experiments.fixture.runs[0];
  assert.throws(() => f.store.experimentResult('fixture', reference), /Duplicate/);
  for (const file of [reference.artifact, f.registration.evaluation.trials[0].outputFile, f.registration.evaluation.trials[0].assessmentFile]) {
    const bytes = fs.readFileSync(file); fs.appendFileSync(file, '\n'); assert.throws(f.review, /changed/); fs.writeFileSync(file, bytes);
  }
  const row = JSON.parse(fs.readFileSync(reference.artifact)); row.conditionHash = 'unbound'; fs.writeFileSync(reference.artifact, JSON.stringify(row));
  assert.throws(() => f.store.experimentResult('fixture', { ...reference, artifactHash: artifactHash(reference.artifact) }), /identity/);
});
test('a reserved interrupted run remains incomplete and cannot be silently excluded', async () => {
  const f = await evaluationFixture(); f.register(); f.store.beginEvaluation('fixture', f.registration.evaluation.trials[0].id);
  const summary = f.store.evaluationSummary('fixture'); assert.equal(summary.reserved, 1); assert.equal(summary.recorded, 0); assert.equal(summary.eligible, false);
});
test('paired policy keeps failures and can review a predeclared large fixture improvement', async () => {
  const f = await evaluationFixture({ nCases: 8, baselinePass: false, policy: { kind: 'paired', minReportTasks: 8, minDelta: 0.1, maxMeanWallRatio: 10 } }); f.register();
  const result = f.run(); assert.equal(result.status, 1); const summary = f.store.evaluationSummary('fixture');
  assert.equal(summary.arms.baseline.failed, 8); assert.equal(summary.arms.candidate.passed, 8); assert.equal(summary.comparison.taskClusters, 8);
  assert.equal(summary.eligible, true); assert.equal(f.review().status, 'reviewed-for-adoption');
});
test('paired no-effect result is inconclusive; repeated tasks do not increase task clusters', async () => {
  const f = await evaluationFixture({ nCases: 2, repeats: 2, policy: { kind: 'paired', minReportTasks: 2, minDelta: 0, maxMeanWallRatio: 10 } }); f.register(); assert.equal(f.run().status, 0);
  const summary = f.store.evaluationSummary('fixture'); assert.equal(summary.comparison.delta, 0); assert.equal(summary.comparison.taskClusters, 2); assert.equal(summary.eligible, false); assert.throws(f.review, /confidence/);
});
test('task variants in one family cannot inflate independent sample count', async () => {
  const f = await evaluationFixture({ nCases: 2, policy: { kind: 'paired', minReportTasks: 2, minDelta: 0, maxMeanWallRatio: 10 } });
  f.registration.evaluation.cases[1].family = 'family-0'; f.register(); f.run(); assert(f.store.evaluationSummary('fixture').reasons.some(reason => reason.includes('families')));
});
test('frozen cost policy fails closed when actual cost evidence is unavailable', async () => {
  const f = await evaluationFixture({ nCases: 8, baselinePass: false, policy: { kind: 'paired', minReportTasks: 8, minDelta: 0.1, maxMeanWallRatio: 10, maxMeanCostRatio: 1.2, costUnit: 'fixture-unit' } }); f.register(); f.run(); assert.throws(f.review, /Cost evidence/);
});
test('hash canonicalization is stable for object order, sensitive to array order', () => {
  assert.equal(evaluationHash({ b: 2, a: 1 }), evaluationHash({ a: 1, b: 2 })); assert.notEqual(evaluationHash([1, 2]), evaluationHash([2, 1]));
});
test('input mutation during execution persists invalid evidence and stops further trials', async () => {
  const f = await evaluationFixture(); const trial = f.registration.evaluation.trials[0];
  trial.command.args = ['-e', `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(trial.outputFile)},JSON.stringify({total:32}));fs.appendFileSync(${JSON.stringify(f.registration.evaluation.arms.candidate.files[0])},Buffer.from([10]));`];
  f.register(); const result = f.run(); assert.equal(result.status, 1, result.stderr);
  const experiment = f.store.read().experiments.fixture; assert.equal(experiment.runs.length, 1);
  const row = JSON.parse(fs.readFileSync(experiment.runs[0].artifact)); assert.equal(row.validity, 'invalid'); assert.match(row.invalidReason, /changed/); assert.throws(f.review, /changed/);
});
test('hard-constraint failure cannot be offset by successful task outcomes', async () => {
  const f = await evaluationFixture(); fs.writeFileSync(f.grader, fs.readFileSync(f.grader, 'utf8').replace('hardConstraintsPassed:true', 'hardConstraintsPassed:false'));
  f.register(); assert.equal(f.run().status, 1); assert.equal(f.store.evaluationSummary('fixture').arms.candidate.passed, 1); assert.throws(f.review, /Hard constraint/);
});
test('verifier timeout remains an invalid paid-or-unpaid attempt rather than a pass', async () => {
  const f = await evaluationFixture(); f.registration.evaluation.trials[0].verify.args = ['-e', 'setTimeout(()=>{},10000)']; f.registration.evaluation.trials[0].verify.timeoutMs = 50;
  f.register(); const result = f.run(); assert.equal(result.status, 1); const row = JSON.parse(result.stdout).runs[0]; assert.equal(row.validity, 'invalid'); assert.equal(row.verification.outcome, 'failed'); assert.equal(f.store.evaluationSummary('fixture').reserved, 1);
});
