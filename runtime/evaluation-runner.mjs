import fs from 'node:fs';
import path from 'node:path';
import { artifactHash, artifactObservation, checkBindings } from './evaluation.mjs';

const OUTPUT_MODIFIED = 'output-modified-during-verification';
const OUTPUT_NOT_REGULAR = 'output-not-regular-file';
export const OUTPUT_HARDLINK = 'output-hardlink';
const ASSESSMENT_NOT_REGULAR = 'assessment-not-regular-file';
export const ASSESSMENT_HARDLINK = 'assessment-hardlink';
// The snapshot uses lstat semantics: a symbolic link (even one that resolves to a regular file),
// a directory and every special file are not artifacts and carry no byte hash. The same
// observation reports the hard-link count, so a regular file that is only a second name for bytes
// someone else wrote (an oracle outside the project, or a frozen input) can be refused at run time
// without touching artifactHash, the frozen input bindings or the receipts that are re-verified
// from those hashes.
const artifactSnapshot = file => artifactObservation(file);

export function runEvaluation(store, request, planFile, runCheck, safeData) {
  const allowed = ['schemaVersion', 'experimentId', 'evaluationDigest'];
  if (Object.keys(request).some(key => !allowed.includes(key))) throw Error('Evaluation v2 commands come only from the registered frozen plan');
  const experiment = store.read().experiments[request.experimentId];
  if (experiment?.status !== 'candidate' || experiment.evaluation?.schemaVersion !== 2 || request.evaluationDigest !== experiment.evaluation.digest) throw Error('Registered evaluation identity mismatch');
  const contract = experiment.evaluation, planPath = fs.realpathSync(planFile), requestHash = artifactHash(planPath), recorded = new Set(experiment.runs.map(row => row.trialId));
  const results = [];
  for (const trial of contract.plan.trials) {
    if (recorded.has(trial.id)) continue;
    checkBindings(contract);
    if (artifactHash(planPath) !== requestHash) throw Error('Evaluation request changed');
    if ([trial.outputFile, trial.assessmentFile].some(file => fs.existsSync(file))) throw Error('Trial outputs must be fresh; inspect before execution');
    const attempt = store.beginEvaluation(experiment.id, trial.id);
    const execution = runCheck(trial.command);
    // Snapshot the candidate artifact before the external verifier starts. The
    // verifier may only inspect the bytes the task adapter produced; if it (or
    // anything else) rewrites or replaces outputFile during verification, the
    // graded result would be based on bytes the verifier itself wrote.
    const beforeVerification = artifactSnapshot(trial.outputFile);
    // The artifact must be a regular file the adapter actually wrote. A symbolic link (even one
    // that resolves to a readable file), a directory or any special file is not an artifact:
    // refuse before the external verifier starts (and before any assessment is looked at), so a
    // graded result can never be based on bytes reached through a link and no write through that
    // link can touch a target outside the project. A wholly missing output keeps the existing
    // path: the verifier runs and the trial is invalid for want of an artifact.
    const outputNotRegular = beforeVerification.exists && !beforeVerification.regularFile;
    // A regular file with more than one name is a hard link: the bytes may live outside the
    // project (for example a frozen oracle) or in a frozen input, and the adapter may have written
    // nothing at all, so it is refused with its own stable identifier before the external verifier
    // starts. The check is conservative and closes only this shape; reflinks and byte-identical
    // copies with a single name stay indistinguishable here.
    const outputHardLinked = beforeVerification.regularFile && Number.isInteger(beforeVerification.linkCount) && beforeVerification.linkCount > 1;
    const outputRefused = outputNotRegular || outputHardLinked;
    // Only the pre-reviewed external verifier may create the assessment. If the
    // task adapter already produced one, that claim is unverified evidence: the
    // verifier is not run (so it cannot overwrite the file) and the trial is
    // invalid instead of being accepted as a graded result.
    const claimedAssessment = !outputRefused && fs.existsSync(trial.assessmentFile);
    let verification;
    if (outputNotRegular) verification = {
      outcome: 'failed', exitCode: null, signal: null, wallMs: 0, error: OUTPUT_NOT_REGULAR,
      detail: 'Candidate outputFile is not a regular file (symbolic link, directory or special file); external verifier not run',
    };
    else if (outputHardLinked) verification = {
      outcome: 'failed', exitCode: null, signal: null, wallMs: 0, error: OUTPUT_HARDLINK,
      detail: `Candidate outputFile is a hard link (link count ${beforeVerification.linkCount}); only a single-link regular file written by the adapter is an artifact; external verifier not run`,
    };
    else if (claimedAssessment) verification = { outcome: 'failed', exitCode: null, signal: null, wallMs: 0, error: 'assessment-pre-exists', detail: 'External verifier not run: assessment existed before verification' };
    else verification = runCheck(trial.verify);
    const afterVerification = artifactSnapshot(trial.outputFile);
    const outputChangedDuringVerification = !outputRefused && !claimedAssessment
      && (beforeVerification.sha256 !== afterVerification.sha256 || beforeVerification.regularFile !== afterVerification.regularFile);
    if (outputChangedDuringVerification) {
      verification = {
        ...verification, outcome: 'failed', error: OUTPUT_MODIFIED,
        detail: `Candidate output changed during external verification (before=${beforeVerification.sha256 ?? 'missing'}, after=${afterVerification.sha256 ?? 'missing'})`,
        outputBeforeSha256: beforeVerification.sha256, outputAfterSha256: afterVerification.sha256,
      };
    }
    // The assessment is external evidence, so it is read only after verification and only when the
    // path itself is a regular file. lstat semantics match the artifact rule: a symbolic link (even
    // one that resolves to a readable passing assessment), a directory or any special file is
    // refused before its content is read, so a linked file can neither supply nor be rewritten as
    // the graded assessment. A missing assessment keeps the existing generic invalid path.
    const afterAssessment = artifactSnapshot(trial.assessmentFile);
    const assessmentObserved = !outputRefused && !claimedAssessment && !outputChangedDuringVerification;
    const assessmentNotRegular = assessmentObserved && afterAssessment.exists && !afterAssessment.regularFile;
    // A regular assessment file with more than one name is a hard link: verify has finished, but
    // its bytes may belong to a passing assessment written outside this trial, so they are kept and
    // not read as this trial's assessment.
    const assessmentHardLinked = assessmentObserved && !assessmentNotRegular && afterAssessment.regularFile
      && Number.isInteger(afterAssessment.linkCount) && afterAssessment.linkCount > 1;
    const assessmentRefused = assessmentNotRegular || assessmentHardLinked;
    if (assessmentNotRegular) {
      verification = {
        ...verification, outcome: 'failed', error: ASSESSMENT_NOT_REGULAR,
        detail: 'AssessmentFile is not a regular file (symbolic link, directory or special file); its content was not read',
      };
    }
    if (assessmentHardLinked) {
      verification = {
        ...verification, outcome: 'failed', error: ASSESSMENT_HARDLINK,
        detail: `AssessmentFile is a hard link (link count ${afterAssessment.linkCount}); its content was not read as an assessment`,
      };
    }
    let assessment, validity = 'valid', invalidReason = null;
    if (outputNotRegular) {
      validity = 'invalid';
      invalidReason = 'Candidate outputFile is not a regular file (symbolic link, directory or special file); it is not an artifact and the external verifier was not run';
    } else if (outputHardLinked) {
      validity = 'invalid';
      invalidReason = `Candidate outputFile is a hard link (link count ${beforeVerification.linkCount}); it is not a single-link artifact and the external verifier was not run`;
    } else if (claimedAssessment) {
      validity = 'invalid';
      invalidReason = 'Assessment existed before external verification; verify not run';
    } else if (outputChangedDuringVerification) {
      validity = 'invalid';
      invalidReason = `Candidate output was modified during external verification (before=${beforeVerification.sha256 ?? 'missing'}, after=${afterVerification.sha256 ?? 'missing'}); verifier result not accepted`;
    } else if (assessmentNotRegular) {
      validity = 'invalid';
      invalidReason = 'AssessmentFile is not a regular file (symbolic link, directory or special file); its content was not read and the verifier result is not accepted';
    } else if (assessmentHardLinked) {
      validity = 'invalid';
      invalidReason = `AssessmentFile is a hard link (link count ${afterAssessment.linkCount}); its content was not read as an assessment and the verifier result is not accepted`;
    } else {
      try {
        assessment = JSON.parse(fs.readFileSync(trial.assessmentFile, 'utf8'));
        if (!['passed', 'failed'].includes(assessment.taskOutcome) || typeof assessment.hardConstraintsPassed !== 'boolean' || (assessment.validity !== undefined && !['valid', 'invalid'].includes(assessment.validity))) throw Error();
        if (assessment.metrics && (typeof assessment.metrics !== 'object' || Object.values(assessment.metrics).some(value => typeof value !== 'number' && typeof value !== 'string'))) throw Error();
        if (assessment.metrics && ['cost', 'tokens', 'interventions'].some(key => assessment.metrics[key] !== undefined && (!Number.isFinite(assessment.metrics[key]) || assessment.metrics[key] < 0))) throw Error();
        if (verification.outcome !== 'passed' || !beforeVerification.sha256 || !artifactHash(trial.outputFile) || assessment.validity === 'invalid' || (execution.outcome !== 'passed' && assessment.taskOutcome !== 'failed')) throw Error();
      } catch { validity = 'invalid'; invalidReason = 'Missing, inconsistent or invalid verifier assessment/output'; }
    }
    try { checkBindings(contract); if (artifactHash(planPath) !== requestHash) throw Error(); }
    catch { validity = 'invalid'; invalidReason = [invalidReason, 'Frozen input or request changed during trial'].filter(Boolean).join('; '); }
    const row = safeData({
      schemaVersion: 2, trialId: trial.id, attemptId: attempt.attemptId, caseId: trial.caseId,
      split: contract.plan.cases.find(item => item.id === trial.caseId).split, arm: trial.arm,
      conditionHash: contract.armHashes[trial.arm], contractHash: contract.digest,
      execution, verification, validity, invalidReason,
      taskOutcome: validity === 'valid' ? assessment.taskOutcome : 'not-evaluated',
      hardConstraintsPassed: validity === 'valid' ? assessment.hardConstraintsPassed : null,
      metrics: validity === 'valid' ? assessment.metrics ?? null : null,
      // A refused outputFile or assessmentFile is not an artifact or an assessment, so it carries no
      // recorded byte hash even though a regular file with a second name still has readable bytes.
      // The path and the file itself stay in place for inspection.
      output: { path: trial.outputFile, sha256: outputRefused ? null : artifactHash(trial.outputFile) },
      assessment: { path: trial.assessmentFile, sha256: assessmentRefused ? null : artifactHash(trial.assessmentFile) },
    });
    const directory = path.join(store.root, 'evaluations', experiment.id);
    fs.mkdirSync(directory, { recursive: true });
    const artifact = path.join(directory, `${trial.id}-${attempt.attemptId}.json`);
    fs.writeFileSync(artifact, JSON.stringify(row, null, 2) + '\n', { flag: 'wx' });
    store.experimentResult(experiment.id, { trialId: trial.id, artifact, artifactHash: artifactHash(artifact) });
    results.push(row);
    if (validity !== 'valid') break;
  }
  let summary;
  try { summary = store.evaluationSummary(experiment.id); }
  catch { summary = { eligible: false, decision: 'insufficient-evidence', reasons: ['Frozen input or recorded evidence no longer matches'], automaticallyAdopted: false }; }
  return { experiment: experiment.id, runs: results, summary, automaticallyAdopted: false };
}
