import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';

export const VERSION = 'zhenzhi-workflow-v0.1.0';
export const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const phases = new Set(['queued','running','verifying','waiting','needs_decision','blocked','failed','cancelled','complete']);
const stages = new Set(['research','review','implement']);
const idPattern = /^[a-z][a-z0-9-]{0,63}$/;
const secretPattern = /\bsk[-_][A-Za-z0-9_-]{12,}|-----BEGIN [A-Z ]*PRIVATE KEY-----|\b(?:api[_-]?key|authorization|password)\s*[:=]\s*["']?[^\s"']{10,}/i;
export function safeData(value) {
  const json = JSON.stringify(value);
  if (json.length > 256000) throw Error('Record too large; retain a bounded summary and artifact reference');
  if (secretPattern.test(json)) throw Error('Possible credential in record; use a non-secret reference');
  return value;
}
export function fileHash(file) { return fs.existsSync(file) ? hash(fs.readFileSync(file)) : null; }
export function projectPath(project, relative) {
  if (typeof relative !== 'string' || path.isAbsolute(relative) || relative.split(/[\\/]/).some(x => x === '..')) throw Error('Expected a project-relative path');
  const resolved = path.resolve(project, relative);
  if (resolved !== project && !resolved.startsWith(project + path.sep)) throw Error('Path escapes project');
  let parent = resolved;
  while (!fs.existsSync(parent)) parent = path.dirname(parent);
  const real = fs.realpathSync(parent);
  if (real !== project && !real.startsWith(project + path.sep)) throw Error('Path resolves outside project');
  if (/^(?:\.git(?:[\\/]|$))/.test(relative)) throw Error('Git internals are not task artifacts');
  return resolved;
}
export function fingerprint(project, relatives = []) {
  return Object.fromEntries(relatives.map(p => [p,fileHash(projectPath(project,p))]));
}
function requireRevision(task, revision) {
  if (!Number.isInteger(revision) || revision !== task.revision) throw Error('Stale task revision; inspect current task before editing');
}
function validate(state) {
  if (state.schema !== 1) throw Error('Unsupported ledger schema; migration required');
  for (const task of Object.values(state.tasks)) {
    if (!idPattern.test(task.id) || !phases.has(task.phase) || !stages.has(task.stage) || !Number.isInteger(task.revision)) throw Error('Invalid task record');
  }
  return safeData(state);
}
function living(pid) { try { process.kill(pid,0); return true; } catch (e) { return e.code !== 'ESRCH'; } }

export class ProjectStore {
  constructor(project, {stateRoot = path.join(os.homedir(),'.pi','zhenzhi-workflow-state')} = {}) {
    this.project = fs.realpathSync(project);
    this.root = path.resolve(stateRoot, 'projects',hash(this.project.toLowerCase()).slice(0,24));
    this.journal = path.join(this.root,'journal.jsonl');
    this.lock = path.join(this.root,'writer.lock');
  }
  read() {
    if (!fs.existsSync(this.journal)) return {schema:1,sequence:0,project:this.project,tasks:{},events:{},lessons:{},experiments:{}};
    const raw = fs.readFileSync(this.journal,'utf8');
    if (Buffer.byteLength(raw) > 64 * 1024 * 1024) throw Error('Ledger exceeds supported size; explicit archival required');
    if (!raw.endsWith('\n')) throw Error('Interrupted journal tail; preserve the file and recover explicitly, no blind append');
    let previous = '0', sequence = 0, state;
    for (const line of raw.split('\n').filter(Boolean)) {
      const record = JSON.parse(line);
      if (record.sequence !== ++sequence || record.previous !== previous || record.digest !== hash(JSON.stringify(record.state))) throw Error('Ledger integrity/sequence mismatch');
      previous = hash(line); state = validate(record.state);
    }
    if (!state || state.project !== this.project || state.sequence !== sequence) throw Error('Ledger project/sequence mismatch');
    return state;
  }
  transaction(operation, edit) {
    fs.mkdirSync(this.root,{recursive:true});
    let fd;
    try { fd=fs.openSync(this.lock,'wx'); } catch(e) { if(e.code==='EEXIST') throw Error('Project writer lock present; no concurrent write admitted'); throw e; }
    try {
      fs.writeFileSync(fd,JSON.stringify({pid:process.pid,project:this.project,startedAt:new Date().toISOString()})); fs.fsyncSync(fd);
      const state=this.read(); const result=edit(state);
      state.sequence++; validate(state);
      const previous=fs.existsSync(this.journal) ? hash(fs.readFileSync(this.journal,'utf8').trimEnd().split('\n').at(-1)) : '0';
      const record={sequence:state.sequence,previous,operation,time:new Date().toISOString(),state,digest:hash(JSON.stringify(state))};
      const line=JSON.stringify(record)+'\n';
      const log=fs.openSync(this.journal,'a');
      try { fs.writeFileSync(log,line); fs.fsyncSync(log); } finally { fs.closeSync(log); }
      return result;
    } finally { fs.closeSync(fd); fs.unlinkSync(this.lock); }
  }
  unlockDead(expectedPid) {
    const lock=JSON.parse(fs.readFileSync(this.lock,'utf8'));
    if(lock.pid!==expectedPid || living(lock.pid)) throw Error('Lock owner alive or PID mismatch');
    fs.unlinkSync(this.lock); return {removedDeadOwner:expectedPid};
  }
  list() { return Object.values(this.read().tasks); }
  get(id) { const task=this.read().tasks[id]; if(!task) throw Error('Unknown task'); return task; }
  create(input) {
    safeData(input);
    if(!idPattern.test(input.id??'')) throw Error('Use a lowercase task id');
    if(typeof input.goal!=='string'||!input.goal.trim()||input.goal.length>4000) throw Error('A bounded goal is required');
    if(!stages.has(input.stage)) throw Error('Explicit research/review/implement stage required');
    if(!input.authority?.source || !Array.isArray(input.authority.actions)) throw Error('Explicit authorization source/actions required');
    if(!Array.isArray(input.acceptance)||!input.acceptance.length||input.acceptance.some(c=>!idPattern.test(c.id??'')||!c.expected)||new Set(input.acceptance.map(c=>c.id)).size!==input.acceptance.length) throw Error('Unique acceptance ids and observable expected results required');
    const b=input.budget;
    if(!b||!Number.isInteger(b.maxAttempts)||b.maxAttempts<1||b.maxAttempts>25||!Number.isFinite(b.maxWallMinutes)||b.maxWallMinutes<=0||!Number.isInteger(b.maxTokens)||b.maxTokens<1) throw Error('Finite attempts (1..25), wall time and token budget required');
    if(input.authority.actions.some(a=>!['read','write','check'].includes(a))) throw Error('Runtime tasks allow local read/write/check only; external effects require a separate authorized workflow');
    if(!input.authority.actions.includes('read'))throw Error('Scoped read authorization required for a file worker');
    if(input.stage!=='implement'&&input.authority.actions.includes('write')) throw Error('Research/review stage cannot authorize project writes');
    if(input.authority.actions.includes('write')&&(!Array.isArray(input.files)||!input.files.length))throw Error('Writable tasks require explicit file ownership');
    return this.transaction('task.create',state=>{
      if(state.tasks[input.id]) throw Error('Task id already exists');
      const task={id:input.id,revision:1,goal:input.goal,scope:input.scope??'',stage:input.stage,phase:'queued',armed:false,authority:input.authority,acceptance:input.acceptance,context:input.context??[],baseline:fingerprint(this.project,input.files??[]),budget:{...b,maxWorkers:1},spent:{attempts:0,tokens:0,wallMs:0},checkpoint:'',nextAction:'',evidence:[],effects:{},deferred:[],createdAt:new Date().toISOString()};
      state.tasks[task.id]=task; return task;
    });
  }
  update(id,revision,patch) {
    const allowed=new Set(['checkpoint','nextAction','deferred','phase']);
    if(Object.keys(patch).some(k=>!allowed.has(k))) throw Error('Protected task contract cannot be altered by checkpoint update');
    if(patch.phase && (!phases.has(patch.phase)||['complete','running'].includes(patch.phase))) throw Error('Use verifier/claim for complete/running');
    return this.transaction('task.checkpoint',state=>{const t=state.tasks[id];if(!t)throw Error('Unknown task');requireRevision(t,revision);if(['running','complete','cancelled'].includes(t.phase))throw Error('Active/terminal task cannot be checkpoint-edited');Object.assign(t,patch);t.armed=false;t.revision++;return t;});
  }
  arm(id,revision) {
    return this.transaction('task.arm',state=>{
      const t=state.tasks[id];if(!t)throw Error('Unknown task');requireRevision(t,revision);
      if(!['queued','waiting','failed'].includes(t.phase))throw Error('Task cannot be armed; inspect and explicitly checkpoint eligible phase first');
      const now=fingerprint(this.project,Object.keys(t.baseline));
      if(JSON.stringify(now)!==JSON.stringify(t.baseline))throw Error('Project files changed; revise/recreate task contract after inspection');
      if(Object.values(t.effects).some(e=>e.status!=='resolved'))throw Error('Unresolved side effect; inspect actual effect before continuing');
      t.armed=true;t.revision++;return t;
    });
  }
  pause(id,revision) { return this.transaction('task.pause',state=>{const t=state.tasks[id];if(!t)throw Error('Unknown task');requireRevision(t,revision);t.armed=false;if(t.phase==='running')t.cancelRequested=true;t.revision++;return t;}); }
  claim(id,revision) {
    return this.transaction('task.claim',state=>{
      const t=state.tasks[id];if(!t)throw Error('Unknown task');requireRevision(t,revision);
      if(!t.armed||!['queued','waiting','failed'].includes(t.phase))throw Error('Task not eligible');
      if(Object.values(state.tasks).some(x=>x.phase==='running'))throw Error('One project worker at a time');
      if(t.spent.attempts>=t.budget.maxAttempts||t.spent.tokens>=t.budget.maxTokens||t.spent.wallMs>=t.budget.maxWallMinutes*60000)throw Error('Task budget exhausted');
      if(Object.values(t.effects).some(e=>e.status!=='resolved'))throw Error('Unresolved side effect');
      if(JSON.stringify(fingerprint(this.project,Object.keys(t.baseline)))!==JSON.stringify(t.baseline))throw Error('Task baseline drift');
      t.phase='running';t.armed=false;t.cancelRequested=false;t.spent.attempts++;t.worker={pid:process.pid,token:crypto.randomUUID(),revision:t.revision,startedAt:Date.now()};t.revision++;return t;
    });
  }
  settle(id,token,{tokens=0,wallMs=0,outcome='verifying',failureFingerprint=null}={}) {
    if(!Number.isFinite(tokens)||tokens<0||!Number.isFinite(wallMs)||wallMs<0||!['verifying','failed','waiting','cancelled'].includes(outcome))throw Error('Invalid worker settlement');
    return this.transaction('task.settle',state=>{const t=state.tasks[id];if(!t||t.worker?.token!==token||t.phase!=='running')throw Error('Stale worker');const current=fingerprint(this.project,Object.keys(t.baseline));const unchanged=JSON.stringify(current)===JSON.stringify(t.baseline);t.failureStreak=outcome==='failed'&&unchanged?(failureFingerprint&&failureFingerprint===t.lastFailure?t.failureStreak+1:1):0;t.lastFailure=failureFingerprint;t.spent.tokens+=tokens;t.spent.wallMs+=wallMs;t.phase=t.cancelRequested?'cancelled':t.failureStreak>=2?'needs_decision':outcome;t.armed=false;t.worker=null;t.baseline=current;t.revision++;return t;});
  }
  recover(id,revision) {
    return this.transaction('task.recover',state=>{const t=state.tasks[id];if(!t)throw Error('Unknown task');requireRevision(t,revision);if(t.phase!=='running'||living(t.worker.pid))throw Error('Only a dead worker can be recovered');t.phase='needs_decision';t.armed=false;t.spent.wallMs+=Math.max(0,Date.now()-t.worker.startedAt);t.spent.tokens=t.budget.maxTokens;t.recoveryNote='Unsettled usage unknown; remaining token budget withheld. Inspect effects/costs and create a newly authorized bounded task.';for(const e of Object.values(t.effects))if(e.status==='intent')e.status='unknown';t.worker=null;t.revision++;return t;});
  }
  effectIntent(id,revision,actionId,description) {
    if(!idPattern.test(actionId))throw Error('Stable business action id required');
    return this.transaction('effect.intent',state=>{const t=state.tasks[id];if(!t)throw Error('Unknown task');requireRevision(t,revision);if(t.effects[actionId])throw Error('Business action already recorded; inspect outcome');t.effects[actionId]={description:safeData(description),status:'intent',createdAt:new Date().toISOString()};t.armed=false;t.revision++;return t;});
  }
  resolveEffect(id,revision,actionId,observation) {
    if(!observation?.reference||!['happened','not-happened'].includes(observation.observed))throw Error('Actual outcome and evidence reference required');
    return this.transaction('effect.resolve',state=>{const t=state.tasks[id];if(!t)throw Error('Unknown task');requireRevision(t,revision);const e=t.effects[actionId];if(!e)throw Error('Unknown action');e.status='resolved';e.observation=safeData(observation);t.revision++;return t;});
  }
  evidence(id,revision,record) {
    if(!record?.artifact||!['passed','failed','not-run','not-applicable'].includes(record.outcome)||!['self','independent','deterministic'].includes(record.review))throw Error('Evidence requires artifact, outcome and review kind');
    return this.transaction('evidence.record',state=>{const t=state.tasks[id];if(!t)throw Error('Unknown task');requireRevision(t,revision);t.evidence.push({...safeData(record),baseline:fingerprint(this.project,Object.keys(t.baseline)),time:new Date().toISOString()});t.revision++;return t;});
  }
  complete(id,revision) {
    return this.transaction('task.complete',state=>{const t=state.tasks[id];if(!t)throw Error('Unknown task');requireRevision(t,revision);if(t.phase!=='verifying')throw Error('Task must enter verifying phase');if(Object.values(t.effects).some(e=>e.status!=='resolved'))throw Error('Unresolved side effect');
      const current=fingerprint(this.project,Object.keys(t.baseline));
      for(const criterion of t.acceptance){const e=t.evidence.filter(x=>x.criterion===criterion.id).at(-1);if(!e||e.outcome!=='passed'||JSON.stringify(e.baseline)!==JSON.stringify(current)|| (criterion.independent===true&&e.review==='self'))throw Error('Missing/stale/insufficient acceptance evidence: '+criterion.id);}
      t.phase='complete';t.armed=false;t.revision++;return t;
    });
  }
  ingest({source,eventId,revision,payload}) {
    if(!source||!eventId||!revision)throw Error('Event needs stable source/id/revision');safeData(payload);
    const key=hash(JSON.stringify([source,eventId,revision]));if(this.read().events[key])return {duplicate:true,key};
    return this.transaction('inbox.ingest',state=>{if(state.events[key])return {duplicate:true,key};state.events[key]={source,eventId,revision,payload,status:'new',createdAt:new Date().toISOString()};return {duplicate:false,key};});
  }
  triage(key,{classification,reason}) {
    if(!['relevant','uncertain','ignore'].includes(classification)||!reason)throw Error('Classification/reason required');
    return this.transaction('inbox.triage',state=>{if(!state.events[key])throw Error('Unknown event');Object.assign(state.events[key],{status:classification,reason:safeData(reason)});return state.events[key];});
  }
  lesson(input) {
    if(!idPattern.test(input.id??'')||!input.scope||!input.source||!input.observation)throw Error('Lesson needs id, scope, source and observation');
    return this.transaction('lesson.propose',state=>{if(state.lessons[input.id])throw Error('Update the owning lesson, do not duplicate');state.lessons[input.id]={...safeData(input),status:'candidate',version:1};return state.lessons[input.id];});
  }
  promoteLesson(id,{evidence,location}) {
    return this.transaction('lesson.review',state=>{const l=state.lessons[id];if(!l||l.status!=='candidate'||!evidence||!location)throw Error('Reviewed evidence and owning location required');l.status='reviewed';l.evidence=evidence;l.location=location;l.version++;return l;});
  }
  amendLesson(id,version,patch) {
    if(Object.keys(patch).some(k=>!['scope','observation','conditions','links','supersededBy'].includes(k)))throw Error('Amend facts/links only; review state requires review');
    return this.transaction('lesson.amend',state=>{const l=state.lessons[id];if(!l||l.version!==version)throw Error('Stale/unknown lesson');Object.assign(l,safeData(patch));l.status='candidate';l.version++;return l;});
  }
  proposeExperiment(input) {
    if(!idPattern.test(input.id??'')||!input.change||!input.baseline||!input.candidate||!input.splits?.development||!input.splits?.selection||!input.splits?.report||new Set(Object.values(input.splits)).size!==3)throw Error('Experiment needs one change, baseline/candidate and distinct splits');
    if(!Number.isInteger(input.maxTrials)||input.maxTrials<1||input.maxTrials>100)throw Error('Finite experiment trials required');
    return this.transaction('experiment.propose',state=>{if(state.experiments[input.id])throw Error('Experiment already exists');state.experiments[input.id]={...safeData(input),status:'candidate',runs:[]};return state.experiments[input.id];});
  }
  experimentResult(id,record) {
    return this.transaction('experiment.result',state=>{const e=state.experiments[id];if(!e||e.status!=='candidate'||e.runs.length>=e.maxTrials)throw Error('Experiment unavailable/budget exhausted');if(!record.caseId||!record.candidateHash||!record.artifact||!['development','selection','report'].includes(record.split)||typeof record.correct!=='boolean')throw Error('Structured experiment evidence required');e.runs.push(safeData(record));return e;});
  }
  reviewExperiment(id,decision) {
    return this.transaction('experiment.review',state=>{const e=state.experiments[id];if(!e||!['adopt','reject'].includes(decision.action)||!decision.reviewer||!decision.reason)throw Error('Explicit reviewer and decision required');
      if(decision.action==='adopt'&&(!e.runs.some(r=>r.split==='report')||e.runs.some(r=>r.split==='report'&&(!r.correct||r.boundaryFailure))||!decision.rollback))throw Error('Independent final results and rollback required');
      e.status=decision.action==='adopt'?'reviewed-for-adoption':'rejected';e.decision=safeData(decision);return e;
    });
  }
  snapshot(id) {
    const t=this.get(id);const actual=fingerprint(this.project,Object.keys(t.baseline));
    return {version:VERSION,task:t,projectDrift:JSON.stringify(actual)!==JSON.stringify(t.baseline),unresolvedEffects:Object.values(t.effects).filter(e=>e.status!=='resolved').length,recoveryDoesNotActivate:true};
  }
}

// Execute a verifier chosen outside the candidate. No shell interpolation.
// A successful process exit proves only the named check, not arbitrary semantics.
export function runCheck({executable,args=[],cwd,timeoutMs=60000}) {
  if(!path.isAbsolute(executable)||!Array.isArray(args)||args.some(a=>typeof a!=='string'))throw Error('Absolute executable and structured args required');
  if(!Number.isFinite(timeoutMs)||timeoutMs<1||timeoutMs>600000)throw Error('Bounded verifier timeout required');
  const start=Date.now(); const result=spawnSync(executable,args,{cwd,encoding:'utf8',timeout:timeoutMs,windowsHide:true,maxBuffer:1024*1024});
  return {outcome:result.status===0&&!result.error?'passed':'failed',exitCode:result.status,signal:result.signal,wallMs:Date.now()-start,commandHash:hash(JSON.stringify({executable,args})),stdoutHash:hash(result.stdout??''),stderrHash:hash(result.stderr??''),error:result.error?.code??null};
}
