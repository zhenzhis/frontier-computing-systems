import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export async function evaluationFixture({ repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), nCases = 1, repeats = 1, baselinePass = true, candidatePass = true, policy = { kind: 'regression', minReportTasks: 1 } } = {}) {
  const { ProjectStore } = await import(pathToFileURL(path.join(repository, 'runtime/control.mjs')));
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'fcs-evaluation-'));
  const project = path.join(root, 'project'), verifier = path.join(root, 'verifier');
  fs.mkdirSync(project); fs.mkdirSync(verifier);
  const stateRoot = path.join(root, 'state'), store = new ProjectStore(project, { stateRoot });
  const arms = {};
  for (const [arm, passed] of Object.entries({ baseline: baselinePass, candidate: candidatePass })) {
    const file = path.join(project, `${arm}.cjs`);
    fs.writeFileSync(file, `const fs=require('node:fs');const [input,output]=process.argv.slice(2);const rows=JSON.parse(fs.readFileSync(input,'utf8'));fs.writeFileSync(output,JSON.stringify({total:rows.reduce((sum,row)=>sum+row.quantity*row.price,0)${passed ? '' : '+1'}}));\n`);
    arms[arm] = { files: [file], config: { algorithm: 'invoice-total', fixture: true } };
  }
  const grader = path.join(verifier, 'grade.cjs');
  fs.writeFileSync(grader, "const fs=require('node:fs');const [oracle,output,assessment]=process.argv.slice(2);const actual=JSON.parse(fs.readFileSync(output,'utf8'));const expected=JSON.parse(fs.readFileSync(oracle,'utf8'));fs.writeFileSync(assessment,JSON.stringify({taskOutcome:actual.total===expected.total?'passed':'failed',hardConstraintsPassed:true}));\n");
  const cases = [], trials = [];
  for (let i = 0; i < nCases; i++) {
    const input = path.join(project, `input-${i}.json`), oracle = path.join(verifier, `oracle-${i}.json`);
    fs.writeFileSync(input, JSON.stringify([{ quantity: i + 1, price: 17 }, { quantity: 3, price: 5 }]));
    fs.writeFileSync(oracle, JSON.stringify({ total: (i + 1) * 17 + 15 }));
    cases.push({ id: `case-${i}`, family: `family-${i}`, split: 'report', inputFiles: [input], oracleFile: oracle });
    for (let repeat = 1; repeat <= repeats; repeat++) for (const arm of Object.keys(arms)) {
      const id = `case-${i}-${arm}-${repeat}`, outputFile = path.join(project, `${id}-output.json`), assessmentFile = path.join(verifier, `${id}-assessment.json`);
      trials.push({ id, caseId: `case-${i}`, arm, repeat, outputFile, assessmentFile,
        command: { executable: process.execPath, args: [arms[arm].files[0], input, outputFile], cwd: project },
        verify: { executable: process.execPath, args: [grader, oracle, outputFile, assessmentFile], cwd: verifier } });
    }
  }
  const registration = { id: 'fixture', change: 'Synthetic invoice algorithm comparison', baseline: 'baseline', candidate: 'candidate', splits: { development: 'dev', selection: 'select', report: 'heldout' }, maxTrials: trials.length,
    evaluation: { schemaVersion: 2, condition: { model: 'none; deterministic fixture', provider: 'none', modelVersion: 'none', reasoning: 'none', sampling: 'deterministic', context: 'fixture inputs only', tools: ['node'], environment: { node: process.version, platform: process.platform }, budget: { paidInference: false, maxTrials: trials.length } }, arms, cases, trials, verifierFiles: [grader], policy } };
  const requestFile = path.join(root, 'request.json');
  const register = () => { const experiment = store.proposeExperiment(registration); fs.writeFileSync(requestFile, JSON.stringify({ schemaVersion: 2, experimentId: experiment.id, evaluationDigest: experiment.evaluation.digest })); return experiment; };
  const run = () => spawnSync(process.execPath, [path.join(repository, 'runtime/evaluate.mjs'), project, requestFile, stateRoot], { encoding: 'utf8', windowsHide: true, maxBuffer: 8 * 1024 * 1024 });
  const review = () => store.reviewExperiment('fixture', { action: 'adopt', reviewer: 'fixture-reviewer', reason: 'Independent deterministic fixture checks only', rollback: 'baseline' });
  return { repository, root, project, verifier, stateRoot, store, registration, requestFile, grader, register, run, review };
}
