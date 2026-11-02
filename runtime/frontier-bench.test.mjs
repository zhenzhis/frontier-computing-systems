import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Superagent,digest} from './superagent.mjs';
import {FrontierLab} from './frontier.mjs';
import {BENCH_VERSION,comparePairs,runFrontierStudy} from './frontier-bench.mjs';

/**
 * Scorer calibration for the only independent evaluator of automatic limited adoption.
 * The rule under test is the documented public one: an artifact counts as a pass only when the
 * recorded file bytes equal taskCase().expected exactly. Every near-miss below is a plausible
 * "almost right" artifact that a trim / newline-normalising / value-parsing judge, or a model
 * judge, would wrongly accept — so these cases keep the boundary reproducible after any change to
 * comparePairs, to the row scoring in runFrontierStudy, or to the artifact comparison itself.
 * Nothing here calls a model, network or credential; every write stays under os.tmpdir().
 * A reproducible rejection boundary is engineering evidence about this scorer only: it is not
 * scientific validity, broad capability or real-project benefit.
 */

const temporary=()=>fs.mkdtempSync(path.join(os.tmpdir(),'fcs-bench-'));
const hypothesis={kind:'prompt-policy',hypothesis:'Inspect authoritative evidence before writing an artifact to avoid stale answers.',candidatePolicy:'Read authoritative.json and verify exact bytes before finalizing answer.txt.',falsifier:'No independent artifact success improvement on selection and held-out pairs.'};

// The task fixture itself is produced by taskCase(); reading it back keeps the expectation derived
// from taskCase (id + ':' + authoritative value + one LF) instead of re-deriving an internal seed.
const taskOf=directory=>{
 const facts=JSON.parse(fs.readFileSync(path.join(directory,'authoritative.json'),'utf8'));
 return{id:facts.id,authoritative:facts.authoritative,stale:facts.stale};
};
const exact=task=>`${task.id}:${task.authoritative}\n`;
const nearMiss={
 trailingSpace:task=>`${task.id}:${task.authoritative} \n`,
 crlfLineEnding:task=>`${task.id}:${task.authoritative}\r\n`,
 missingFinalLf:task=>`${task.id}:${task.authoritative}`,
 extraExplanationLine:task=>`${task.id}:${task.authoritative}\nExplanation: copied the authoritative value.\n`,
 bomPrefix:task=>`\ufeff${task.id}:${task.authoritative}\n`,
 leadingWhitespace:task=>` ${task.id}:${task.authoritative}\n`,
 truncatedId:task=>`${task.id.slice(0,6)}:${task.authoritative}\n`,
 rewrittenValue:task=>`${task.id}:${String(Number(task.authoritative)-1)}\n`,
 draftStaleValue:task=>task.stale!==task.authoritative?`${task.id}:${task.stale}\n`:null
};
const placement=directory=>{
 const name=path.basename(directory),arm=name.slice(name.indexOf('-')+1);
 return{arm,split:path.basename(path.dirname(directory)),pair:Number(name.slice(0,name.indexOf('-')))};
};

/**
 * Runs the real study executor with an injected offline runRole. `write` receives the arm, split,
 * pair, task and prompt and returns {bytes,variant}; a null/undefined `bytes` means "produce no
 * artifact". Every recorded row is bound to the taskCase-derived expectation through the scorer's
 * own expectedHash, so the calibration cannot drift onto a different artifact contract.
 */
async function fixtureStudy({seed='calibration',condition={model:'fixture-bytes'},write}){
 const root=temporary(),plan=new Map();let calls=0;
 const result=await runFrontierStudy({root,hypothesis,condition,seed,runRole:async(_role,directory,prompt)=>{
  calls++;
  const where=placement(directory),task=taskOf(directory),step=write({...where,task,directory,prompt})??{};
  plan.set(`${where.split}/${where.pair}/${where.arm}`,{task,variant:step.variant??null,bytes:step.bytes??null});
  if(step.bytes!==null&&step.bytes!==undefined)fs.writeFileSync(path.join(directory,'answer.txt'),step.bytes);
  return{completed:true};
 }});
 const rows=fs.readFileSync(path.join(root,'trials.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse)
  .map(row=>{const known=plan.get(`${row.split}/${row.pair}/${row.arm}`)??{};return{...row,...known}});
 assert.equal(rows.length,result.trials,'every recorded trial is preserved');
 for(const row of rows)assert.equal(row.expectedHash,digest(exact(row.task)),'calibration must bind to the frozen taskCase expected bytes');
 return{root,result,rows,calls};
}

test('the artifact-pairs byte scorer accepts exact artifacts and rejects every derived near-miss',async()=>{
 assert.equal(BENCH_VERSION,'fcs-artifact-pairs-v1','calibration targets the documented scorer version');
 const control=await fixtureStudy({write:({arm,task,prompt})=>arm==='candidate'&&prompt.includes('Experimental procedure')?{bytes:exact(task),variant:'exact'}:{}});
 assert.equal(control.result.accepted,true,'exact bytes must still be the only accepted artifact');
 assert.equal(control.result.selection.passed,true);
 assert.equal(control.result.heldout.passed,true);
 assert.equal(control.calls,control.result.trials);
 const controlCandidates=control.rows.filter(r=>r.arm==='candidate');
 assert.equal(controlCandidates.length,14);
 assert(controlCandidates.every(r=>r.passed===true),'exact bytes must pass every studied pair');
 const complete=[];
 for(const [name,mutate] of Object.entries(nearMiss)){
  const study=await fixtureStudy({seed:`calibration/${name}`,write:({arm,task,prompt})=>{
   if(arm!=='candidate'||!prompt.includes('Experimental procedure'))return{};
   const bytes=mutate(task);
   return bytes===null?{bytes:exact(task),variant:'draft-value-already-current'}:{bytes,variant:name};
  }});
  const candidates=study.rows.filter(r=>r.arm==='candidate'),applied=candidates.filter(r=>r.variant===name);
  assert(applied.length>0,`${name} must be exercised by at least one studied pair`);
  for(const row of applied){
   assert.notEqual(row.bytes,exact(row.task),`${name} must differ from the expected bytes`);
   assert.equal(row.passed,false,`near-miss ${name} must be scored as a failure at ${row.split}/${row.pair}`);
  }
  assert.equal(study.rows.filter(r=>r.variant===name&&r.passed).length,0,`a near-miss artifact is never a pass, so it can never be a win`);
  // A stale draft only expresses a near-miss when it differs from the authoritative value; when it
  // is already current the pair carries exact bytes and legitimately passes.
  for(const row of candidates.filter(r=>r.variant==='draft-value-already-current'))assert.equal(row.passed,true);
  if(applied.length===candidates.length){complete.push(name);assert.equal(study.result.selection.wins,0,`near-miss ${name} must leave the candidate with no win`)}
  assert.equal(study.result.accepted,false,`near-miss ${name} must never produce limited adoption`);
  assert.equal(study.result.heldout,null,`a failed selection must not open the held-out set for ${name}`);
  assert.equal(fs.existsSync(path.join(study.root,'heldout')),false);
  assert.equal(comparePairs(study.rows.filter(r=>r.split==='selection')).passed,false,`comparePairs must refuse ${name}`);
  assert.equal(study.calls,study.result.trials,'a rejected artifact is recorded, never retried');
 }
 assert(complete.length>=6,`at least six near-miss classes need full-pair coverage; got ${complete.join(',')}`);
});

test('one near-miss artifact in selection is a regression, so five exact wins cannot accept it',async()=>{
 const study=await fixtureStudy({seed:'mixed-selection',write:({arm,split,pair,task,prompt})=>{
  const candidate=arm==='candidate'&&prompt.includes('Experimental procedure'),loss=split==='selection'&&pair===0;
  if(candidate)return{bytes:loss?nearMiss.crlfLineEnding(task):exact(task),variant:loss?'near-miss':'exact'};
  if(arm==='baseline'&&loss)return{bytes:exact(task),variant:'baseline-exact'};
  return{};
 }});
 assert.equal(study.result.selection.wins,5);
 assert.equal(study.result.selection.losses,1);
 assert.equal(study.result.selection.baseline,1);
 assert.equal(study.result.selection.candidate,5);
 assert.equal(study.result.selection.passed,false,'five exact wins cannot pay for one near-miss regression');
 assert.equal(study.result.heldout,null);
 assert.equal(study.result.accepted,false);
 assert.equal(study.result.status,'complete');
 assert.equal(study.result.trials,16);
 assert.equal(study.calls,16,'every arm is attempted once, with no optional retry');
 assert.equal(fs.readFileSync(path.join(study.root,'trials.jsonl'),'utf8').trim().split('\n').length,16);
 assert.equal(fs.readFileSync(path.join(study.root,'attempts.jsonl'),'utf8').trim().split('\n').filter(Boolean).length,1);
 assert.equal(fs.existsSync(path.join(study.root,'heldout')),false);
});

test('one near-miss artifact in the held-out set blocks acceptance after an exact selection pass',async()=>{
 const study=await fixtureStudy({seed:'mixed-heldout',write:({arm,split,pair,task,prompt})=>{
  const candidate=arm==='candidate'&&prompt.includes('Experimental procedure'),loss=split==='heldout'&&pair===0;
  if(candidate)return{bytes:loss?nearMiss.missingFinalLf(task):exact(task),variant:loss?'near-miss':'exact'};
  if(arm==='baseline'&&loss)return{bytes:exact(task),variant:'baseline-exact'};
  return{};
 }});
 assert.equal(study.result.selection.passed,true);
 assert.equal(study.result.selection.wins,6);
 assert.equal(study.result.selection.losses,0);
 assert.equal(study.result.heldout.wins,5);
 assert.equal(study.result.heldout.losses,1);
 assert.equal(study.result.heldout.candidate,5);
 assert.equal(study.result.heldout.passed,false,'a held-out near-miss is a regression, not a tie');
 assert.equal(study.result.accepted,false);
 assert.equal(study.result.status,'complete');
 assert.equal(study.result.trials,28);
 assert.equal(study.calls,28);
});

test('an all-near-miss candidate earns zero wins, no limited adoption and no frontier lesson',async()=>{
 const project=temporary(),store=new Superagent(project,{stateRoot:path.join(project,'state')});
 store.configure({authorization:'fixture',mode:'auto',allowed:[],sources:['repository'],rules:[]});
 let workerCalls=0;
 const lab=new FrontierLab(store,{enabled:true,authorization:'fixture',exactModel:'fixture-model',provider:'fixture',sources:[{id:'upstream',kind:'page',url:'https://example.org/research',intervalSeconds:300}]},{
  revision:()=> 'frozen-revision',
  now:()=>1000000,
  sourceReader:async()=>({items:[{url:'https://example.org/research/a',title:'Evidence',excerpt:'A concrete source claim'}]}),
  role:async(name,directory,prompt)=>{
   if(name!=='worker')return{summary:'A falsifiable original hypothesis',findings:[],hypothesis};
   workerCalls++;
   if(!prompt.includes('Experimental procedure'))return{completed:true};
   fs.writeFileSync(path.join(directory,'answer.txt'),nearMiss.trailingSpace(taskOf(directory)));
   return{completed:true};
  }
 });
 try{
  await lab.tick({idle:true});
  const state=store.get('frontier-state','current'),studies=store.list('frontier-study');
  assert.equal(state.stage,'idle');
  assert.equal(state.lastOutcome,'not-adopted');
  assert.equal(studies.length,1);
  const study=studies[0];
  assert.equal(study.accepted,false);
  assert.equal(study.status,'complete');
  assert.equal(study.selection.wins,0);
  assert.equal(study.selection.candidate,0);
  assert.equal(study.selection.passed,false);
  assert.equal(study.heldout,null);
  assert.equal(store.list('frontier-lesson').length,0,'rejected artifacts cannot become a limited-adoption lesson');
  assert.equal(store.list('frontier-hypothesis')[0].status,'not-adopted');
  const root=path.join(store.root,'frontier',state.lastResearchId);
  const trials=fs.readFileSync(path.join(root,'trials.jsonl'),'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  assert.equal(trials.length,16,'two development and six selection pairs are retained');
  assert.equal(workerCalls,16,'no arm is retried');
  assert.equal(fs.readFileSync(path.join(root,'attempts.jsonl'),'utf8').trim().split('\n').filter(Boolean).length,1);
  assert(trials.filter(r=>r.arm==='candidate').every(r=>r.passed===false),'every near-miss candidate row is a failure');
  assert(trials.filter(r=>r.arm==='candidate').every(r=>r.error===null),'the rejection comes from the artifact bytes, not an infrastructure error');
 }finally{store.close();}
});
