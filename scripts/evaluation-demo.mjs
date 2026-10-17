import fs from 'node:fs';
import path from 'node:path';
import { evaluationFixture } from '../tests/evaluation-fixture.mjs';

// Offline acceptance walkthrough of the actual controller and external grader.
// Deliberately labelled fixtures; never a model benchmark or human preference.
const index = process.argv.indexOf('--repository');
const repository = index >= 0 ? path.resolve(process.argv[index + 1]) : undefined;
const checks = [], fixtures = [];
for (const scenario of ['correct-artifact', 'near-miss', 'no-op', 'wrong-identity']) {
  const f = await evaluationFixture({ repository, nCases: scenario === 'correct-artifact' || scenario === 'near-miss' ? 2 : 1, candidatePass: scenario !== 'near-miss' });
  if (scenario === 'no-op') for (const trial of f.registration.evaluation.trials) { trial.command.args = ['-e', 'process.exit(0)']; trial.verify.args = ['-e', 'process.exit(0)']; }
  f.register();
  if (scenario === 'wrong-identity') { const request = JSON.parse(fs.readFileSync(f.requestFile)); request.evaluationDigest = 'wrong'; fs.writeFileSync(f.requestFile, JSON.stringify(request)); }
  const run = f.run(), summary = f.store.evaluationSummary('fixture');
  const passed = scenario === 'correct-artifact' ? run.status === 0 && summary.eligible && summary.arms.candidate.passed === 2
    : scenario === 'near-miss' ? run.status === 1 && !summary.eligible && summary.arms.candidate.failed === 2
    : scenario === 'no-op' ? run.status === 1 && !summary.eligible && summary.arms.baseline.invalid === 1
    : run.status === 1 && summary.reserved === 0;
  checks.push({ scenario, passed, processExitCode: run.status, summary }); fixtures.push(f.root);
}
const report = { kind: 'offline harness acceptance; not model performance or maintainer UX', passed: checks.every(check => check.passed), checks, fixtures, modelRequests: 0, paidExecution: false };
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
