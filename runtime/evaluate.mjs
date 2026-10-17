import fs from 'node:fs';
import path from 'node:path';
import { ProjectStore,runCheck,fileHash,safeData } from './control.mjs';
import { runEvaluation } from './evaluation-runner.mjs';
const [project,planFile,stateRoot]=process.argv.slice(2);
try{
  const plan=JSON.parse(fs.readFileSync(planFile,'utf8')),store=new ProjectStore(project,stateRoot?{stateRoot}:{});
  if(plan.schemaVersion===2){const result=runEvaluation(store,plan,planFile,runCheck,safeData);console.log(JSON.stringify(result,null,2));if(result.runs.some(row=>row.validity!=='valid'||row.taskOutcome!=='passed'||!row.hardConstraintsPassed))process.exitCode=1;}
  else {
  if(!Number.isInteger(plan.maxTrials)||plan.maxTrials<1||plan.maxTrials>100||!Array.isArray(plan.cases)||!plan.cases.length||plan.cases.length>plan.maxTrials||!plan.candidateHash)throw Error('Finite evaluation plan and candidate hash required');
  const experiment=store.read().experiments[plan.experimentId];if(!experiment||experiment.status!=='candidate'||experiment.runs.length+plan.cases.length>experiment.maxTrials)throw Error('Register candidate and reserve enough trial budget');
  if(experiment.evaluation)throw Error('Evaluation v2 requires its registered version-bound request');
  // Final check inputs must be outside the worker's file-access scope. OS isolation
  // of verifier processes is separate; this runner does not claim it provides one.
  const inside=p=>p.toLowerCase()===store.project.toLowerCase()||p.toLowerCase().startsWith((store.project+path.sep).toLowerCase()),oracles=new Map();
  for(const c of plan.cases){
    if(!c.id||!['development','selection','report'].includes(c.split))throw Error('Each case needs id and split');
    if(c.split==='report'){if(!c.oracleFile||inside(fs.realpathSync(c.oracleFile)))throw Error('Report oracle must exist outside worker project');oracles.set(c.oracleFile,fileHash(c.oracleFile));}
  }
  const before=fileHash(planFile),runs=[],runDir=path.join(store.root,'evaluations',`${plan.experimentId}-${Date.now()}`);fs.mkdirSync(runDir,{recursive:true});
  for(const [index,c] of plan.cases.entries()){
    const result=runCheck({executable:c.executable,args:c.args,cwd:c.cwd??store.project,timeoutMs:c.timeoutMs??60000});
    const boundaryFailure=fileHash(planFile)!==before||[...oracles].some(([p,h])=>fileHash(p)!==h);
    const row=safeData({caseId:c.id,split:c.split,candidateHash:plan.candidateHash,artifact:path.join(runDir,`${index}.json`),correct:!boundaryFailure&&result.outcome==='passed',boundaryFailure,...result});
    fs.writeFileSync(row.artifact,JSON.stringify(row,null,2)+'\n');store.experimentResult(plan.experimentId,row);runs.push(row);
    if(boundaryFailure)throw Error('Plan/oracle changed; recorded boundary failure and stopped');
  }
  console.log(JSON.stringify({experiment:plan.experimentId,runs,automaticallyAdopted:false},null,2));if(runs.some(r=>!r.correct))process.exitCode=1;
  }
}catch(error){console.error(String(error.message).replace(/\bsk[-_][\w-]+/g,'[redacted]'));process.exitCode=1;}
