import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { evaluationFixture } from './evaluation-fixture.mjs';
import { artifactHash, evaluationHash } from '../runtime/evaluation.mjs';

// The symbolic-link regressions below need real links. Windows without developer mode or the
// symlink privilege throws EPERM/EACCES for them; that platform records an explicit skip instead
// of passing silently. The probe touches only the (already disposable) fixture directory.
function symlinkUnavailable(directory) {
  const target = path.join(directory, `symlink-probe-target-${process.pid}.json`);
  const link = path.join(directory, `symlink-probe-${process.pid}.json`);
  try {
    fs.writeFileSync(target, '{"total":0}\n');
    fs.symlinkSync(target, link, 'file');
    return null;
  } catch (error) {
    if (['EPERM', 'EACCES', 'ENOSYS', 'ENOTSUP', 'EINVAL'].includes(error.code)) return error.code;
    throw error;
  } finally {
    try { fs.unlinkSync(link); } catch {}
    try { fs.unlinkSync(target); } catch {}
  }
}

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
test('report verifier cwd or executable inside or defaulting to the project is refused before reservation', async () => {
  const f = await evaluationFixture(); const plan = f.registration.evaluation, trial = plan.trials[0], original = { ...trial.verify };
  delete trial.verify.cwd; assert.throws(f.register, /Report verifier cwd must be outside worker project/);
  trial.verify = { ...original, cwd: f.project }; assert.throws(f.register, /Report verifier cwd must be outside worker project/);
  trial.verify = { ...original, executable: plan.cases[0].inputFiles[0] }; assert.throws(f.register, /Report verifier executable must be outside worker project/);
  assert.equal(f.store.read().experiments.fixture, undefined); assert.equal(fs.existsSync(trial.outputFile), false); assert.equal(fs.existsSync(trial.assessmentFile), false);
});
test('report verifier args may only reference the trial output inside the project', async () => {
  const f = await evaluationFixture(); const plan = f.registration.evaluation, trial = plan.trials[0], original = trial.verify.args;
  const local = path.join(f.project, 'local-grader.cjs'); fs.writeFileSync(local, 'process.exit(0);\n');
  trial.verify.args = [local, ...original.slice(1)]; assert.throws(f.register, /must stay outside worker project except the trial outputFile/);
  trial.verify.args = [path.relative(f.verifier, local), ...original.slice(1)]; assert.throws(f.register, /must stay outside worker project except the trial outputFile/);
  const future = path.join(f.project, 'future-grader.cjs');
  trial.verify.args = [future, ...original.slice(1)]; assert.throws(f.register, /must stay outside worker project except the trial outputFile/);
  trial.verify.args = [path.relative(f.verifier, future), ...original.slice(1)]; assert.throws(f.register, /must stay outside worker project except the trial outputFile/);
  trial.verify.args = ['--strict', ...original]; const experiment = f.register();
  assert(experiment.evaluation.plan.trials[0].verify.args.includes('--strict')); assert(experiment.evaluation.plan.trials[0].verify.args.includes(trial.outputFile));
});
test('report verifier attached flag values inside the project are refused before reservation', async () => {
  // Negative evidence: on 020a470c (before attached values were path-checked) both forms below
  // registered successfully and created the experiment record; reproduce by reverting only
  // runtime/evaluation.mjs on this commit.
  const f = await evaluationFixture(); const trial = f.registration.evaluation.trials[0];
  const local = path.join(f.project, 'answers.json'); fs.writeFileSync(local, '{"total":32}\n');
  trial.verify.args = ['--oracle=' + local]; assert.throws(f.register, /must stay outside worker project except the trial outputFile/);
  trial.verify.args = ['--config=' + path.relative(f.verifier, path.join(f.project, 'expected.json'))]; assert.throws(f.register, /must stay outside worker project except the trial outputFile/);
  assert.equal(f.store.read().experiments.fixture, undefined); assert.equal(fs.existsSync(trial.outputFile), false); assert.equal(fs.existsSync(trial.assessmentFile), false);
});
test('report verifier attached flag values outside the project or naming the trial output stay accepted', async () => {
  const f = await evaluationFixture(); const trial = f.registration.evaluation.trials[0], original = trial.verify.args;
  const external = path.join(f.verifier, 'oracle-extra.json'); fs.writeFileSync(external, '{"total":32}\n');
  const args = ['--oracle=' + external, '--out=' + trial.outputFile, '--strict', ...original];
  trial.verify.args = args; const experiment = f.register();
  assert.deepEqual(experiment.evaluation.plan.trials[0].verify.args, args);
});
// Negative evidence (base a7681688, before paired quoted content was path-checked): all forms
// below registered successfully when the fixture root contained a space, because splitting quoted
// text on whitespace produced fragments that each resolved outside the project. The check must
// treat each paired quote span as one whole path. Reproduce by reverting only
// runtime/evaluation.mjs on this commit.
test('report verifier quoted project paths under a whitespace-containing root are refused before reservation', async () => {
  const refused = /must stay outside worker project except the trial outputFile/;
  const forms = [
    ['double-quoted whole argument', local => [`"${local}"`]],
    ['single-quoted whole argument', local => [`'${local}'`]],
    ['backtick-quoted whole argument', local => ['`' + local + '`']],
    ['quoted attached value', local => [`--oracle="${local}"`]],
    ['quoted path in inline code', local => ['-e', `const fs=require('node:fs');fs.readFileSync(\"${local}\",'utf8')`]],
  ];
  const outcomes = [];
  for (const [label, argsFor] of forms) {
    const f = await evaluationFixture({ temporaryPrefix: 'fcs evaluation-' });
    const trial = f.registration.evaluation.trials[0], local = path.join(f.project, 'answers.json');
    fs.writeFileSync(local, '{"total":32}\n');
    assert.match(local, / /, 'fixture root must contain whitespace');
    trial.verify.args = argsFor(local);
    let error = null, registered = false;
    try { f.register(); registered = true; } catch (thrown) { error = thrown; }
    outcomes.push({ label, f, trial, error, registered });
  }
  assert.deepEqual(outcomes.filter(item => item.registered).map(item => item.label), [], 'quoted project paths must not register');
  for (const { label, f, trial, error } of outcomes) {
    assert.match(error?.message ?? '', refused, label);
    assert.equal(f.store.read().experiments.fixture, undefined);
    assert.equal(fs.existsSync(trial.outputFile), false);
    assert.equal(fs.existsSync(trial.assessmentFile), false);
  }
  // The same whitespace-containing fixture still accepts quoted external paths, the existing
  // unquoted forms and the trial outputFile exception.
  const accepted = await evaluationFixture({ temporaryPrefix: 'fcs evaluation-' });
  const trial = accepted.registration.evaluation.trials[0], original = trial.verify.args;
  const external = path.join(accepted.verifier, 'oracle extra.json');
  fs.writeFileSync(external, '{"total":32}\n');
  const args = [`"${external}"`, `--oracle="${external}"`, `--oracle=${external}`, `--out="${trial.outputFile}"`, `"${trial.outputFile}"`, ...original];
  trial.verify.args = args;
  const experiment = accepted.register();
  assert.deepEqual(experiment.evaluation.plan.trials[0].verify.args, args);
});
// Negative evidence (discovery-b9fb3d669c50-1992903, revision before this check existed): with this
// same fixture, trials[0].verify.args = ['-e', "const fs=require('node:fs');" +
//   "fs.readFileSync('<fixture-root>/project/answers.json','utf8')"] registered successfully — the
// registration returned an experiment, store.read().experiments.fixture existed and nothing was
// thrown — although the answers file sits inside the candidate project, because only whole-argument
// and `--flag=value` positions were resolved as paths. Paths below are sanitized to
// '<fixture-root>'. Reproduce by reverting only runtime/evaluation.mjs on this commit.
test('report verifier argument text embedding a project path is refused before reservation', async () => {
  const f = await evaluationFixture(); const trial = f.registration.evaluation.trials[0];
  const local = path.join(f.project, 'answers.json'); fs.writeFileSync(local, '{"total":32}\n');
  const slash = local.split(path.sep).join('/'), refused = /must stay outside worker project except the trial outputFile/;
  const inline = quoted => ['-e', `const fs=require('node:fs');fs.readFileSync(${quoted},'utf8')`];
  trial.verify.args = inline(`'${local}'`); assert.throws(f.register, refused);
  trial.verify.args = inline(`"${local}"`); assert.throws(f.register, refused);
  trial.verify.args = ['--payload={"file":"' + slash + '"}']; assert.throws(f.register, refused);
  trial.verify.args = inline(`'${path.relative(f.verifier, local).split(path.sep).join('/')}'`); assert.throws(f.register, refused);
  assert.equal(f.store.read().experiments.fixture, undefined);
  assert.equal(fs.existsSync(trial.outputFile), false); assert.equal(fs.existsSync(trial.assessmentFile), false);
});
test('inline report verifier text without a project path stays accepted and executes', async () => {
  const f = await evaluationFixture(); const trial = f.registration.evaluation.trials[0], oracle = f.registration.evaluation.cases[0].oracleFile;
  const code = "const fs=require('node:fs');const [oracle,output,assessment]=process.argv.slice(-3);const actual=JSON.parse(fs.readFileSync(output,'utf8')),expected=JSON.parse(fs.readFileSync(oracle,'utf8'));fs.writeFileSync(assessment,JSON.stringify({taskOutcome:actual.total===expected.total?'passed':'failed',hardConstraintsPassed:true}));";
  trial.verify.args = ['-e', code, oracle, trial.outputFile, trial.assessmentFile];
  const experiment = f.register(); assert.equal(experiment.evaluation.plan.trials[0].verify.args[0], '-e');
  const run = f.run(); assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout), row = result.runs.find(item => item.trialId === trial.id);
  assert.equal(row.validity, 'valid'); assert.equal(row.taskOutcome, 'passed'); assert.equal(row.verification.outcome, 'passed');
  assert.equal(result.summary.eligible, true);
});
test('development and selection trials may keep a project-local verifier', async () => {
  for (const split of ['development', 'selection']) {
    const f = await evaluationFixture(); const plan = f.registration.evaluation, trial = plan.trials[0], local = path.join(f.project, 'local-grader.cjs');
    fs.copyFileSync(f.grader, local); plan.cases[0].split = split; plan.verifierFiles = [local];
    trial.verify = { executable: process.execPath, args: [local, plan.cases[0].oracleFile, trial.outputFile, trial.assessmentFile], cwd: f.project };
    f.register(); const run = f.run(); assert.equal(run.status, 0, run.stderr);
    const result = JSON.parse(run.stdout); assert.equal(result.runs.length, 2); assert(result.runs.every(row => row.verification.outcome === 'passed')); assert.equal(result.summary.eligible, false);
  }
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
// Negative evidence: before the runner checked the assessment before verification, this same
// fixture row was accepted as valid/passed and could reach review, because a zero-exit verifier
// plus an adapter-written assessment satisfied every check. Reproduce by reverting only
// runtime/evaluation-runner.mjs on this commit and running this test.
test('a task adapter cannot supply the assessment before external verification', async () => {
  const f = await evaluationFixture(); const trial = f.registration.evaluation.trials[0];
  const forged = JSON.stringify({ taskOutcome: 'passed', hardConstraintsPassed: true, validity: 'valid' });
  trial.command.args = ['-e', `const fs=require('node:fs');fs.writeFileSync(${JSON.stringify(trial.outputFile)},JSON.stringify({total:32}));fs.writeFileSync(${JSON.stringify(trial.assessmentFile)},${JSON.stringify(forged)});`];
  trial.verify.args = ['-e', 'process.exit(0)'];
  f.register(); const run = f.run(); assert.equal(run.status, 1); const result = JSON.parse(run.stdout);
  assert.equal(result.runs.length, 1); const row = result.runs[0];
  assert.equal(row.execution.outcome, 'passed'); assert.equal(row.verification.outcome, 'failed');
  assert.equal(row.validity, 'invalid'); assert.equal(row.taskOutcome, 'not-evaluated'); assert.equal(row.hardConstraintsPassed, null);
  assert.match(row.invalidReason, /Assessment existed before external verification/);
  assert.equal(row.assessment.sha256, artifactHash(trial.assessmentFile));
  assert.equal(result.summary.decision, 'insufficient-evidence'); assert.equal(result.summary.eligible, false);
  assert.throws(f.review, /Incomplete frozen trial manifest/);
  assert.equal(fs.readFileSync(trial.assessmentFile, 'utf8'), forged);
});
test('a read-only external verifier keeps the candidate artifact valid', async () => {
  const f = await evaluationFixture(); const trial = f.registration.evaluation.trials[0], oracle = f.registration.evaluation.cases[0].oracleFile;
  trial.verify.args = ['-e', "const fs=require('node:fs');const [oracle,output,assessment]=process.argv.slice(-3);const actual=JSON.parse(fs.readFileSync(output,'utf8'));const expected=JSON.parse(fs.readFileSync(oracle,'utf8'));fs.writeFileSync(assessment,JSON.stringify({taskOutcome:actual.total===expected.total?'passed':'failed',hardConstraintsPassed:true}));", oracle, trial.outputFile, trial.assessmentFile];
  f.register(); const run = f.run(); assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout), row = result.runs[0];
  assert.equal(row.validity, 'valid'); assert.equal(row.taskOutcome, 'passed'); assert.equal(row.hardConstraintsPassed, true);
  assert.equal(row.verification.outcome, 'passed'); assert.equal(row.verification.error, null);
  assert.equal(row.output.sha256, artifactHash(trial.outputFile)); assert.equal(result.summary.eligible, true);
  assert.equal(f.review().status, 'reviewed-for-adoption');
});
// Negative evidence: before the runner snapshotted outputFile across verification, this fixture was
// recorded as valid/passed and reached review even though the verifier appended a byte and supplied
// the passing assessment itself. Reproduce by reverting only runtime/evaluation-runner.mjs.
test('an artifact rewritten during external verification is invalid and stops later trials', async () => {
  const f = await evaluationFixture(); const trials = f.registration.evaluation.trials;
  const mutation = "const fs=require('node:fs');const [output,assessment]=process.argv.slice(-2);fs.appendFileSync(output,Buffer.from([32]));fs.writeFileSync(assessment,JSON.stringify({taskOutcome:'passed',hardConstraintsPassed:true,validity:'valid'}));";
  trials[0].verify.args = ['-e', mutation, trials[0].outputFile, trials[0].assessmentFile];
  f.register(); const run = f.run(); assert.equal(run.status, 1, run.stderr);
  const result = JSON.parse(run.stdout), row = result.runs[0];
  assert.equal(result.runs.length, 1); assert.equal(row.execution.outcome, 'passed');
  assert.equal(row.validity, 'invalid'); assert.equal(row.taskOutcome, 'not-evaluated'); assert.equal(row.hardConstraintsPassed, null);
  assert.equal(row.verification.outcome, 'failed'); assert.equal(row.verification.error, 'output-modified-during-verification');
  assert.notEqual(row.verification.outputBeforeSha256, row.verification.outputAfterSha256);
  assert.equal(row.verification.outputAfterSha256, artifactHash(trials[0].outputFile)); assert.equal(row.output.sha256, artifactHash(trials[0].outputFile));
  assert.match(row.invalidReason, /modified during external verification/);
  assert(row.invalidReason.includes(row.verification.outputBeforeSha256)); assert(row.invalidReason.includes(row.verification.outputAfterSha256));
  const experiment = f.store.read().experiments.fixture; assert.equal(experiment.runs.length, 1); assert.equal(experiment.attempts.length, 1);
  assert.equal(fs.existsSync(trials[0].outputFile), true); assert.equal(fs.existsSync(trials[1].outputFile), false);
  const summary = f.store.evaluationSummary('fixture'); assert.equal(summary.eligible, false); assert.equal(summary.decision, 'insufficient-evidence');
  assert.throws(f.review, /Incomplete frozen trial manifest/);
});
// Negative evidence for the artifact-kind check (derived from the pre-fix code, not re-executed
// here): with the old snapshot (`fs.statSync(file).isFile()`, which follows links) and a validity
// rule that never required a regular file, this exact shape was recorded as validity=valid,
// taskOutcome=passed and could reach review. The command created only a symbolic link from
// outputFile to the external oracle (<fixture-root>/verifier/oracle-0.json, a path derivable from
// the project path), the external verifier read the oracle bytes through the link, actual.total
// equalled expected.total and no artifact was produced. Reproduce by reverting only the
// `outputNotRegular` refusal in runtime/evaluation-runner.mjs together with the lstat semantics of
// artifactState/artifactHash in runtime/evaluation.mjs on this commit.
// The link is kept in place after the run, so the assertion on its target below shows the bypass
// without any revert: reading outputFile resolves to the bytes that would have graded as passed.
test('a symbolic link to the external oracle is not an artifact and the verifier never runs', async t => {
  const f = await evaluationFixture();
  const unavailable = symlinkUnavailable(f.project);
  if (unavailable) { t.skip(`symbolic link creation unavailable on this platform (${unavailable}); the regression cannot be exercised offline here`); return; }
  const trials = f.registration.evaluation.trials, trial = trials[0], oracle = f.registration.evaluation.cases[0].oracleFile;
  trial.command.args = ['-e', `const fs=require('node:fs');fs.symlinkSync(${JSON.stringify(oracle)},${JSON.stringify(trial.outputFile)},'file');`];
  f.register();
  const run = f.run(); assert.equal(run.status, 1, run.stderr);
  const result = JSON.parse(run.stdout), row = result.runs[0];
  assert.equal(result.runs.length, 1); assert.equal(row.execution.outcome, 'passed');
  assert.equal(row.verification.outcome, 'failed'); assert.equal(row.verification.error, 'output-not-regular-file');
  assert.match(row.verification.detail, /outputFile is not a regular file/); assert.match(row.verification.detail, /verifier not run/);
  assert.equal(row.validity, 'invalid'); assert.equal(row.taskOutcome, 'not-evaluated'); assert.equal(row.hardConstraintsPassed, null);
  assert.equal(row.output.sha256, null); assert.equal(row.assessment.sha256, null);
  assert.equal(fs.lstatSync(trial.outputFile).isSymbolicLink(), true); assert.equal(fs.existsSync(trial.assessmentFile), false);
  assert.equal(JSON.parse(fs.readFileSync(trial.outputFile, 'utf8')).total, JSON.parse(fs.readFileSync(oracle, 'utf8')).total);
  const experiment = f.store.read().experiments.fixture; assert.equal(experiment.runs.length, 1); assert.equal(experiment.attempts.length, 1);
  assert.equal(fs.existsSync(trials[1].outputFile), false); assert.equal(fs.existsSync(trials[1].assessmentFile), false);
  assert.equal(result.summary.eligible, false); assert.equal(result.summary.decision, 'insufficient-evidence');
  const summary = f.store.evaluationSummary('fixture'); assert.equal(summary.eligible, false); assert.equal(summary.decision, 'insufficient-evidence');
  assert.equal(summary.recorded, 1); assert.equal(summary.planned, 2);
  assert.throws(f.review, /Incomplete frozen trial manifest; Invalid trials require investigation, not silent exclusion/);
});
// Negative evidence (actually reproduced at base 582a44d with this fixture from a disposable copy of
// that revision's archive): the verifier-created assessment symlink
// was followed. The row written into the evaluation directory carried validity=valid,
// taskOutcome=passed, hardConstraintsPassed=true, verification.outcome=passed and
// assessment.sha256=null, and store.experimentResult then threw "Valid trial needs a consistent
// execution result, verifier and real artifacts": run exit=1, stdout empty, experiment.runs=0. So
// the recorded line already claimed valid/passed and the run failed closed only afterwards with a
// generic message. Reproduce by reverting only runtime/evaluation-runner.mjs on this commit.
// The external target below holds a passing assessment and its bytes are never rewritten; the link
// is kept in place so the assertions on it show the bypass shape without any revert.
test('a symbolic link standing in for the assessment is refused before its content is read', async t => {
  const f = await evaluationFixture();
  const unavailable = symlinkUnavailable(f.project);
  if (unavailable) { t.skip(`symbolic link creation unavailable on this platform (${unavailable}); the regression cannot be exercised offline here`); return; }
  const trials = f.registration.evaluation.trials, trial = trials[0];
  const external = path.join(f.root, 'external-assessment.json'), forged = JSON.stringify({ taskOutcome: 'passed', hardConstraintsPassed: true });
  fs.writeFileSync(external, forged);
  trial.verify.args = ['-e', "const fs=require('node:fs');const [external,assessment]=process.argv.slice(-2);fs.symlinkSync(external,assessment,'file');", external, trial.assessmentFile];
  f.register();
  const run = f.run(); assert.equal(run.status, 1, run.stderr);
  const result = JSON.parse(run.stdout), row = result.runs[0];
  assert.equal(result.runs.length, 1); assert.equal(row.execution.outcome, 'passed');
  assert.equal(row.verification.outcome, 'failed'); assert.equal(row.verification.error, 'assessment-not-regular-file');
  assert.match(row.verification.detail, /AssessmentFile is not a regular file/); assert.match(row.verification.detail, /content was not read/);
  assert.equal(row.validity, 'invalid'); assert.equal(row.taskOutcome, 'not-evaluated'); assert.equal(row.hardConstraintsPassed, null);
  assert.equal(row.output.sha256, artifactHash(trial.outputFile)); assert.equal(row.assessment.sha256, null);
  assert.doesNotMatch(row.invalidReason, /Missing, inconsistent or invalid verifier assessment/);
  assert.equal(fs.lstatSync(trial.assessmentFile).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(trial.assessmentFile, 'utf8'), forged); assert.equal(fs.readFileSync(external, 'utf8'), forged);
  const experiment = f.store.read().experiments.fixture; assert.equal(experiment.runs.length, 1); assert.equal(experiment.attempts.length, 1);
  assert.equal(fs.existsSync(trials[1].outputFile), false); assert.equal(fs.existsSync(trials[1].assessmentFile), false);
  assert.equal(result.summary.eligible, false); assert.equal(result.summary.decision, 'insufficient-evidence');
  const summary = f.store.evaluationSummary('fixture'); assert.equal(summary.eligible, false); assert.equal(summary.recorded, 1);
  assert.throws(f.review, /Incomplete frozen trial manifest; Invalid trials require investigation, not silent exclusion/);
});
test('a directory standing in for the assessment is refused with the same stable identifier', async () => {
  const f = await evaluationFixture(); const trials = f.registration.evaluation.trials, trial = trials[0];
  trial.verify.args = ['-e', "const fs=require('node:fs');const assessment=process.argv.at(-1);fs.mkdirSync(assessment);", trial.assessmentFile];
  f.register();
  const run = f.run(); assert.equal(run.status, 1, run.stderr);
  const result = JSON.parse(run.stdout), row = result.runs[0];
  assert.equal(result.runs.length, 1); assert.equal(row.execution.outcome, 'passed');
  assert.equal(row.verification.outcome, 'failed'); assert.equal(row.verification.error, 'assessment-not-regular-file');
  assert.match(row.verification.detail, /AssessmentFile is not a regular file/);
  assert.equal(row.validity, 'invalid'); assert.equal(row.taskOutcome, 'not-evaluated'); assert.equal(row.hardConstraintsPassed, null);
  assert.equal(row.output.sha256, artifactHash(trial.outputFile)); assert.equal(row.assessment.sha256, null);
  assert.match(row.invalidReason, /not a regular file/); assert.doesNotMatch(row.invalidReason, /Missing, inconsistent or invalid verifier assessment/);
  assert.equal(fs.lstatSync(trial.assessmentFile).isDirectory(), true);
  assert.equal(fs.existsSync(trials[1].outputFile), false); assert.equal(fs.existsSync(trials[1].assessmentFile), false);
  assert.equal(result.summary.eligible, false); assert.equal(result.summary.decision, 'insufficient-evidence');
  assert.throws(f.review, /Incomplete frozen trial manifest/);
});
// The pre-verification distinction is unchanged: an adapter that creates the assessment itself is
// still refused as assessment-pre-exists (verify does not run), even when that file is a symbolic
// link. The new path-type refusal applies only to an assessment left after the external verifier.
test('a symbolic-link assessment written by the adapter still reports assessment-pre-exists', async t => {
  const f = await evaluationFixture();
  const unavailable = symlinkUnavailable(f.project);
  if (unavailable) { t.skip(`symbolic link creation unavailable on this platform (${unavailable}); the regression cannot be exercised offline here`); return; }
  const trials = f.registration.evaluation.trials, trial = trials[0];
  const external = path.join(f.root, 'adapter-assessment.json'), forged = JSON.stringify({ taskOutcome: 'passed', hardConstraintsPassed: true });
  fs.writeFileSync(external, forged);
  trial.command.args = ['-e', "const fs=require('node:fs');const [output,assessment,external]=process.argv.slice(-3);fs.writeFileSync(output,JSON.stringify({total:32}));fs.symlinkSync(external,assessment,'file');", trial.outputFile, trial.assessmentFile, external];
  trial.verify.args = ['-e', 'process.exit(0)'];
  f.register();
  const run = f.run(); assert.equal(run.status, 1, run.stderr);
  const result = JSON.parse(run.stdout), row = result.runs[0];
  assert.equal(result.runs.length, 1); assert.equal(row.verification.error, 'assessment-pre-exists');
  assert.notEqual(row.verification.error, 'assessment-not-regular-file');
  assert.equal(row.validity, 'invalid'); assert.equal(row.taskOutcome, 'not-evaluated'); assert.equal(row.hardConstraintsPassed, null);
  assert.equal(row.assessment.sha256, null); assert.equal(fs.lstatSync(trial.assessmentFile).isSymbolicLink(), true);
  assert.equal(fs.readFileSync(external, 'utf8'), forged);
  assert.equal(fs.existsSync(trials[1].outputFile), false); assert.equal(fs.existsSync(trials[1].assessmentFile), false);
  assert.equal(result.summary.eligible, false);
});
// Positive control next to the refusal above: the same fixture, with an artifact the command
// actually writes, still grades and reviews. 180-odd existing offline cases keep this contract.
test('an adapter-written regular file stays a valid, reviewable artifact under lstat semantics', async () => {
  const f = await evaluationFixture(); f.register(); const run = f.run(); assert.equal(run.status, 0, run.stderr);
  const trial = f.registration.evaluation.trials[0], result = JSON.parse(run.stdout), row = result.runs[0];
  assert.equal(fs.lstatSync(trial.outputFile).isFile(), true); assert.equal(fs.lstatSync(trial.outputFile).isSymbolicLink(), false);
  assert.equal(row.verification.outcome, 'passed'); assert.equal(row.verification.error, null);
  assert.equal(row.validity, 'valid'); assert.equal(row.taskOutcome, 'passed'); assert.equal(row.hardConstraintsPassed, true);
  assert.equal(row.output.sha256, artifactHash(trial.outputFile)); assert.equal(result.summary.eligible, true);
  assert.equal(f.review().status, 'reviewed-for-adoption');
});
// Recorded evidence is re-read with the same lstat semantics: a symbolic link has no artifact hash,
// so a link standing in for a recorded artifact cannot inherit the receipt's sha256. Restoring the
// original regular file with the same bytes makes the original receipt verifiable again.
test('a recorded artifact replaced by a byte-identical symbolic link is refused until restored', async t => {
  const f = await evaluationFixture();
  const unavailable = symlinkUnavailable(f.project);
  if (unavailable) { t.skip(`symbolic link creation unavailable on this platform (${unavailable}); the regression cannot be exercised offline here`); return; }
  f.register(); const run = f.run(); assert.equal(run.status, 0, run.stderr);
  const trial = f.registration.evaluation.trials[0];
  const recorded = JSON.parse(fs.readFileSync(f.store.read().experiments.fixture.runs[0].artifact, 'utf8'));
  assert.equal(f.store.evaluationSummary('fixture').eligible, true);
  const aside = path.join(f.root, 'artifact-copy.json'), original = path.join(f.root, 'artifact-original.json');
  fs.writeFileSync(aside, fs.readFileSync(trial.outputFile));
  fs.renameSync(trial.outputFile, original); fs.symlinkSync(aside, trial.outputFile, 'file');
  assert.equal(artifactHash(trial.outputFile), null);
  assert.throws(() => f.store.evaluationSummary('fixture'), /Trial output or assessment changed/);
  assert.throws(f.review, /Trial output or assessment changed/);
  fs.unlinkSync(trial.outputFile); fs.copyFileSync(aside, trial.outputFile);
  assert.equal(artifactHash(trial.outputFile), recorded.output.sha256);
  const summary = f.store.evaluationSummary('fixture'); assert.equal(summary.eligible, true); assert.equal(summary.decision, 'eligible-for-review');
  assert.equal(f.review().status, 'reviewed-for-adoption');
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
// Hard links are the second covered artifact shape. The probe links across the same two directories
// the regressions use (verifier → project), so a platform or mount that cannot create a hard link
// records an explicit skip with its stable reason code instead of passing silently. Only
// EPERM/EACCES/EXDEV/ENOTSUP/ENOSYS justify a skip; Linux CI must execute these cases.
function hardLinkUnavailable(root) {
  const target = path.join(root, 'verifier', `hardlink-probe-target-${process.pid}.json`);
  const link = path.join(root, 'project', `hardlink-probe-${process.pid}.json`);
  try {
    fs.writeFileSync(target, '{"total":0}\n');
    fs.linkSync(target, link);
    return null;
  } catch (error) {
    if (['EPERM', 'EACCES', 'EXDEV', 'ENOTSUP', 'ENOSYS'].includes(error.code)) return error.code;
    throw error;
  } finally {
    try { fs.unlinkSync(link); } catch {}
    try { fs.unlinkSync(target); } catch {}
  }
}
// Negative evidence is derived from the pre-fix code, not re-executed here: this worker has no
// shell, so the baseline run on f4541d97 was not performed and is not claimed as measured. On that
// revision the artifact snapshot was `fs.statSync(file).isFile()` and the runner refused only
// non-regular files, so an adapter that wrote no artifact and only left
// `fs.linkSync(<oracleFile>, <outputFile>)` was recorded as validity=valid / taskOutcome=passed /
// verification.outcome=passed: lstat still saw a regular file (nlink=2), the external verifier read
// the oracle bytes through the second name, and the row reached review without any real artifact.
// Reproduce on a disposable copy of f4541d97 by adding only this test's trials and running
// `node --test tests/evaluation.test.mjs`; the equivalent revert on this commit is to drop the
// `outputHardLinked` refusal (and the link count in runtime/evaluation.mjs).
// The link is kept in place after the run, so the assertions below show the bypass shape — a regular
// file with two names whose bytes are the oracle's — without any revert.
test('a hard link to the external oracle is not an artifact and the verifier never runs', async t => {
  const f = await evaluationFixture();
  const unavailable = hardLinkUnavailable(f.root);
  if (unavailable) { t.skip(`hard link creation unavailable on this platform (${unavailable}); the regression cannot be exercised offline here`); return; }
  const trials = f.registration.evaluation.trials, trial = trials[0], oracle = f.registration.evaluation.cases[0].oracleFile;
  // The verifier would leave this marker as its first side effect, so a missing marker proves the
  // external verifier never started. Like every report entry, it lives outside the candidate project.
  const marker = path.join(f.verifier, 'verifier-ran.marker');
  trial.command.args = ['-e', `const fs=require('node:fs');fs.linkSync(${JSON.stringify(oracle)},${JSON.stringify(trial.outputFile)});`];
  trial.verify.args = ['-e', `require('node:fs').writeFileSync(${JSON.stringify(marker)},'ran');`];
  f.register();
  const run = f.run(); assert.equal(run.status, 1, run.stderr);
  const result = JSON.parse(run.stdout), row = result.runs[0];
  assert.equal(result.runs.length, 1); assert.equal(row.execution.outcome, 'passed');
  assert.equal(row.verification.outcome, 'failed'); assert.equal(row.verification.error, 'output-hardlink');
  assert.equal(row.verification.exitCode, null); assert.equal(row.verification.wallMs, 0);
  assert(row.verification.detail.includes(`link count ${fs.lstatSync(trial.outputFile).nlink}`), 'detail must name the link count');
  assert.match(row.verification.detail, /verifier not run/);
  assert.equal(row.validity, 'invalid'); assert.equal(row.taskOutcome, 'not-evaluated'); assert.equal(row.hardConstraintsPassed, null);
  assert.equal(fs.existsSync(marker), false, 'the external verifier must not start');
  assert.equal(fs.existsSync(trial.assessmentFile), false, 'no assessment may be created or read');
  const output = fs.lstatSync(trial.outputFile); assert.equal(output.isFile(), true); assert.equal(output.isSymbolicLink(), false); assert.equal(output.nlink, 2);
  assert.equal(row.output.sha256, artifactHash(trial.outputFile)); assert.equal(row.output.sha256, artifactHash(oracle));
  assert.equal(row.assessment.sha256, null);
  assert.doesNotMatch(row.invalidReason, /Missing, inconsistent or invalid verifier assessment/);
  assert.match(row.invalidReason, /hard link/);
  assert.doesNotMatch(run.stderr, /Valid trial needs/, 'the invalid row must be recorded, not rejected by a generic receipt error');
  const experiment = f.store.read().experiments.fixture; assert.equal(experiment.runs.length, 1); assert.equal(experiment.attempts.length, 1);
  assert.equal(fs.existsSync(trials[1].outputFile), false); assert.equal(fs.existsSync(trials[1].assessmentFile), false);
  assert.equal(result.summary.eligible, false); assert.equal(result.summary.decision, 'insufficient-evidence');
  assert.equal(result.summary.recorded, 1); assert.equal(result.summary.planned, 2);
  const summary = f.store.evaluationSummary('fixture'); assert.equal(summary.eligible, false); assert.equal(summary.decision, 'insufficient-evidence');
  assert.throws(f.review, /Incomplete frozen trial manifest; Invalid trials require investigation, not silent exclusion/);
});
// Negative evidence (same pre-fix derivation, not re-executed here): with only the path-type check
// the verifier-created `fs.linkSync(<external passed JSON>, <assessmentFile>)` was a regular file,
// so the runner parsed the external bytes and recorded the trial as validity=valid /
// taskOutcome=passed. Reproduce on a disposable copy of f4541d97; on this commit, drop only the
// `assessmentHardLinked` refusal in runtime/evaluation-runner.mjs.
test('a hard link standing in for the assessment is refused before its content is parsed', async t => {
  const f = await evaluationFixture();
  const unavailable = hardLinkUnavailable(f.root);
  if (unavailable) { t.skip(`hard link creation unavailable on this platform (${unavailable}); the regression cannot be exercised offline here`); return; }
  const trials = f.registration.evaluation.trials, trial = trials[0];
  const external = path.join(f.verifier, 'external-assessment.json'), forged = JSON.stringify({ taskOutcome: 'passed', hardConstraintsPassed: true });
  fs.writeFileSync(external, forged);
  trial.verify.args = ['-e', "const fs=require('node:fs');const [external,assessment]=process.argv.slice(-2);fs.linkSync(external,assessment);", external, trial.assessmentFile];
  f.register();
  const run = f.run(); assert.equal(run.status, 1, run.stderr);
  const result = JSON.parse(run.stdout), row = result.runs[0];
  assert.equal(result.runs.length, 1); assert.equal(row.execution.outcome, 'passed');
  assert.equal(row.verification.outcome, 'failed'); assert.equal(row.verification.error, 'assessment-hardlink');
  assert.equal(row.verification.exitCode, 0, 'verify must run and finish before the assessment is judged');
  assert(row.verification.detail.includes(`link count ${fs.lstatSync(trial.assessmentFile).nlink}`), 'detail must name the link count');
  assert.match(row.verification.detail, /content was not parsed as an assessment/);
  assert.equal(row.validity, 'invalid'); assert.equal(row.taskOutcome, 'not-evaluated'); assert.equal(row.hardConstraintsPassed, null);
  assert.equal(row.output.sha256, artifactHash(trial.outputFile));
  assert.equal(row.assessment.sha256, artifactHash(trial.assessmentFile)); assert.equal(row.assessment.sha256, artifactHash(external));
  assert.match(row.invalidReason, /hard link/); assert.doesNotMatch(row.invalidReason, /Missing, inconsistent or invalid verifier assessment/);
  const assessment = fs.lstatSync(trial.assessmentFile);
  assert.equal(assessment.isFile(), true); assert.equal(assessment.isSymbolicLink(), false); assert.equal(assessment.nlink, 2);
  assert.equal(fs.readFileSync(trial.assessmentFile, 'utf8'), forged); assert.equal(fs.readFileSync(external, 'utf8'), forged);
  const experiment = f.store.read().experiments.fixture; assert.equal(experiment.runs.length, 1); assert.equal(experiment.attempts.length, 1);
  assert.equal(fs.existsSync(trials[1].outputFile), false); assert.equal(fs.existsSync(trials[1].assessmentFile), false);
  assert.equal(result.summary.eligible, false); assert.equal(result.summary.decision, 'insufficient-evidence');
  const summary = f.store.evaluationSummary('fixture'); assert.equal(summary.eligible, false); assert.equal(summary.recorded, 1); assert.equal(summary.decision, 'insufficient-evidence');
  assert.throws(f.review, /Incomplete frozen trial manifest; Invalid trials require investigation, not silent exclusion/);
});
// The link count is a run-time snapshot only. A hard-link-aware backup or deduplication tool may add
// a second name to a frozen input or to a recorded artifact/assessment; artifactHash stays
// content-only, so bindings and receipt re-verification keep working. The last part records that
// hard links added *after* the receipt are not re-examined (a documented uncovered shape).
test('hard-link counts are a run-time snapshot: frozen inputs and recorded receipts survive extra names', async t => {
  const f = await evaluationFixture();
  const unavailable = hardLinkUnavailable(f.root);
  if (unavailable) { t.skip(`hard link creation unavailable on this platform (${unavailable}); the regression cannot be exercised offline here`); return; }
  f.register();
  const input = f.registration.evaluation.arms.candidate.files[0];
  fs.linkSync(input, path.join(f.project, 'candidate-second-name.cjs'));
  assert.equal(fs.lstatSync(input).nlink, 2);
  const run = f.run(); assert.equal(run.status, 0, run.stderr);
  const result = JSON.parse(run.stdout); assert.equal(result.summary.eligible, true); assert.equal(result.runs.length, 2);
  const trial = f.registration.evaluation.trials[0], row = result.runs.find(item => item.trialId === trial.id);
  assert.equal(row.validity, 'valid'); assert.equal(row.output.sha256, artifactHash(trial.outputFile));
  fs.linkSync(trial.outputFile, path.join(f.project, 'recorded-output-second-name.json'));
  fs.linkSync(trial.assessmentFile, path.join(f.verifier, 'recorded-assessment-second-name.json'));
  assert.equal(fs.lstatSync(trial.outputFile).nlink, 2); assert.equal(fs.lstatSync(trial.assessmentFile).nlink, 2);
  assert.equal(artifactHash(trial.outputFile), row.output.sha256); assert.equal(artifactHash(trial.assessmentFile), row.assessment.sha256);
  const summary = f.store.evaluationSummary('fixture'); assert.equal(summary.eligible, true); assert.equal(summary.decision, 'eligible-for-review');
  assert.equal(f.review().status, 'reviewed-for-adoption');
});
