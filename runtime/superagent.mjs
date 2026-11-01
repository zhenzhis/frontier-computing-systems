import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import {DatabaseSync} from 'node:sqlite';
import {Engine, key, ticketStage, latestAssignment, liveTicket, isoTime} from '../vendor/dsh-superagent-core/index.mjs';
import {safeData} from './control.mjs';

export const digest=value=>crypto.createHash('sha256').update(typeof value==='string'?value:JSON.stringify(value)).digest('hex');
export function superagentDirectory(project,stateRoot=path.join(os.homedir(),'.pi','fcs-superagent-state')) {
 return path.join(path.resolve(stateRoot),digest(fs.realpathSync(project).toLowerCase()).slice(0,24));
}
const encode=value=>JSON.stringify(safeData(value));
const decode=row=>row?JSON.parse(row.value):undefined;

/** How many trailing Inputs the inline projection carries; older ones stay reachable through `refs` and `read`. */
export const CONTEXT_INPUT_WINDOW=8;
/** The six fields the inline projection carries when the whole ticket fits its budget. */
const CONTEXT_FIELDS=['id','title','mandate','latest','inputs','refs'];
/** Degradation ladder for an oversized projection: fewer trailing Inputs, then shorter free-text leaves, then no `refs`. */
const CONTEXT_INPUT_COUNTS=[8,6,4,3,2,1,0];
const CONTEXT_ALLOWANCES=[512,256,128,64,32,16,8,4,2,0];
/** A path naming a durable record: a shortened id, digest or timestamp would still look like a usable reference. */
const CONTEXT_IDENTITY=/(?:^|\.)(?:id|ids|triggerId|triggerIds|policyVersion|threadKey|at|from|to|deliveredTo|readAt|idleAt|createdAt|startedAt|endedAt)$/;
/** Copy one value into the budget: a long string becomes a visible marker whose exact loss is also recorded at its path. */
function contextBudget(value,allowance,path,caps) {
 if(typeof value==='string') {
  if(value.length<=allowance||CONTEXT_IDENTITY.test(path))return value;
  const kept=Math.max(0,Math.min(allowance,value.length));
  caps[path]={originalChars:value.length,keptChars:kept};
  return{truncated:true,originalChars:value.length,keptChars:kept,head:value.slice(0,kept)};
 }
 if(Array.isArray(value))return value.map((item,index)=>contextBudget(item,allowance,`${path}[${index}]`,caps));
 if(value&&typeof value==='object'){const copy={};for(const [name,item] of Object.entries(value))copy[name]=contextBudget(item,allowance,path?`${path}.${name}`:name,caps);return copy}
 return value;
}
/** One narrowed projection of the same fields: every cut is marked, dropped Inputs and dropped fields are named. */
function narrowedContext(full,{inputs,allowance,refs}) {
 const caps={},omitted=[],window=full.inputs??[],carried=full.refs??[],value={id:full.id},kept=Math.max(0,Math.min(inputs,window.length));
 if(full.title!==undefined)value.title=contextBudget(full.title,allowance,'title',caps);
 if(full.mandate!==undefined)value.mandate=contextBudget(full.mandate,allowance,'mandate',caps);
 if(full.latest!==undefined)value.latest=contextBudget(full.latest,allowance,'latest',caps);
 if(kept)value.inputs=contextBudget(window.slice(window.length-kept),allowance,'inputs',caps);else if(window.length)omitted.push('inputs');
 if(kept<window.length)caps.inputs={available:window.length,kept,droppedIds:window.slice(0,window.length-kept).map(item=>item?.id??null)};
 // A continuation handle is carried whole or dropped and named: a shortened `trigger/` or `thread/` reference would still look usable.
 if(refs&&carried.length)value.refs=carried;else if(carried.length)omitted.push('refs');
 value.truncated=true;if(omitted.length)value.omitted=omitted;value.caps=caps;
 return value;
}
/** The head allowance that keeps the most free text for one shape, so the ladder's coarse steps are not the last word on a budget. */
function contextAllowance(full,shape,maxChars) {
 const fits=allowance=>JSON.stringify(narrowedContext(full,{...shape,allowance})).length<=maxChars;
 if(!fits(0))return null;
 let low=0,high=maxChars;
 while(low<high){const middle=Math.ceil((low+high)/2);if(fits(middle))low=middle;else high=middle-1}
 return low;
}
/** What a budget too small for any narrowed field can still carry, longest first: the record id when it fits, else nothing. Dropped fields stay named in the returned `omitted`. */
const contextResidue=full=>[[{id:full.id,truncated:true,omitted:CONTEXT_FIELDS.slice(1)},CONTEXT_FIELDS.slice(1)],[{id:full.id,truncated:true},CONTEXT_FIELDS.slice(1)],[{truncated:true,omitted:CONTEXT_FIELDS},CONTEXT_FIELDS],[{truncated:true},CONTEXT_FIELDS],[{},CONTEXT_FIELDS]];
/** The longest still-parseable projection that fits `maxChars`, filled with insignificant whitespace so a narrowed slot keeps its exact width. Every loss it makes is named in `caps` or `omitted`. */
export function fitInlineContext(full,maxChars) {
 let best;
 const keep=value=>{const content=JSON.stringify(value),kept=(value.inputs??[]).length;
  if(content.length>maxChars)return;
  if(!best||content.length>best.content.length||content.length===best.content.length&&kept>best.kept)best={content,caps:value.caps??{},omitted:value.omitted??[],kept};
 };
 for(const inputs of CONTEXT_INPUT_COUNTS)for(const refs of [true,false]) {
  for(const allowance of CONTEXT_ALLOWANCES)keep(narrowedContext(full,{inputs,allowance,refs}));
  const allowance=contextAllowance(full,{inputs,refs},maxChars);
  if(allowance!==null)keep(narrowedContext(full,{inputs,allowance,refs}));
 }
 if(!best)for(const [value,omitted] of contextResidue(full)) {
  const content=JSON.stringify(value);
  if(content.length<=maxChars){best={content,caps:{},omitted,kept:0};break}
 }
 if(!best)throw Error('An inline context budget must admit at least an empty JSON object');
 // The narrowed slot keeps the width the earlier character slice always produced, without cutting the object: JSON ignores the trailing whitespace fill.
 const text=best.content+' '.repeat(maxChars-best.content.length);
 return{text,contentChars:best.content.length,caps:best.caps,omitted:best.omitted,kept:best.kept};
}

/** Durable host adapters for the unmodified upstream domain Engine. No model or network calls. */
export class Superagent {
 constructor(project,{stateRoot,now=()=>new Date().toISOString()}={}) {
  this.project=fs.realpathSync(project);this.root=superagentDirectory(project,stateRoot);this.now=now;
  fs.mkdirSync(this.root,{recursive:true});this.db=new DatabaseSync(path.join(this.root,'superagent.sqlite'));
  this.db.exec('PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; CREATE TABLE IF NOT EXISTS objects(kind TEXT,id TEXT,value TEXT NOT NULL,PRIMARY KEY(kind,id)); CREATE TABLE IF NOT EXISTS effects(id TEXT PRIMARY KEY,kind TEXT,value TEXT NOT NULL,status TEXT NOT NULL DEFAULT \'pending\',attempts INTEGER NOT NULL DEFAULT 0,due INTEGER NOT NULL DEFAULT 0,lease TEXT,error TEXT);');
  const list=kind=>this.db.prepare('SELECT value FROM objects WHERE kind=? ORDER BY rowid').all(kind).map(decode);
  const get=(kind,id)=>decode(this.db.prepare('SELECT value FROM objects WHERE kind=? AND id=?').get(kind,id));
  const put=(kind,id,value)=>this.db.prepare('INSERT INTO objects VALUES(?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value').run(kind,id,encode(value));
  this.get=get;this.put=put;this.list=list;this.depth=0;
  this.repo={atomic:work=>this.atomic(work),
   triggers:{get:id=>get('trigger',id),save:t=>put('trigger',t.id,t),disposition:id=>get('disposition',id),saveDisposition:(id,v)=>put('disposition',id,v)},
   threads:{get:id=>get('thread',id),save:t=>put('thread',t.key,t),list:()=>list('thread'),active:()=>list('thread').filter(t=>t.pending.length||t.evaluating)},
   tickets:{get:id=>get('ticket',id),save:t=>put('ticket',t.id,t),list:()=>list('ticket').reverse(),open:()=>list('ticket').filter(liveTicket),active:()=>list('ticket').filter(t=>t.undelivered.length||['pending','running'].includes(latestAssignment(t)?.state))},
   decisions:{get:id=>get('decision',id),save:d=>put('decision',d.id,d),byThread:id=>list('decision').filter(d=>d.threadKey===id)}};
  this.engine=new Engine({repo:this.repo,policy:()=>this.policy(),now,
   scope:{scope:trigger=>this.sourceScope(trigger)},
   assessor:{request:c=>this.enqueue('assess',c.evalId,c),release:id=>this.cancelEffect(id)},
   executor:{start:(t,a)=>this.enqueue('launch',a.id,{ticketId:t.id,assignmentId:a.id}),deliver:(t,a)=>this.enqueue('input',key('input-delivery',a.id,...t.undelivered),{ticketId:t.id,assignmentId:a.id}),stop:(t,a,reason)=>this.enqueue('stop',key('stop',a.id),{ticketId:t.id,assignmentId:a.id,reason})},
   outbox:{send:m=>{if(!get('receipt',m.id)){put('receipt',m.id,{...m,status:'pending'});this.enqueue('reply',key('reply-effect',m.id),{messageId:m.id})}},status:id=>get('receipt',id)?.status,withdraw:id=>{const r=get('receipt',id);if(r?.status==='pending'){put('receipt',id,{...r,status:'dropped'});this.cancelEffect(key('reply-effect',id))}}},
   emit:event=>put('event',crypto.randomUUID(),event)});
 }
 atomic(work) {
  if(this.depth)return work();this.db.exec('BEGIN IMMEDIATE');this.depth++;
  try{const result=work();this.db.exec('COMMIT');return result}catch(error){this.db.exec('ROLLBACK');throw error}finally{this.depth--}
 }
 configure(config,expectedRevision=0) {
  safeData(config);if(!config.authorization||!['off','observe','auto'].includes(config.mode)||!Array.isArray(config.allowed)||!Array.isArray(config.rules))throw Error('Explicit authorization, mode, allowed actors and rules required');
  if(config.rules.some(r=>!r.id||!r.scope||typeof r.enabled!=='boolean'))throw Error('Rules require stable identity, scope and enabled state');
  return this.atomic(()=>{const old=this.get('config','current');if((old?.revision??0)!==expectedRevision)throw Error('Stale configuration revision');
   // The version digest reads its fields by name, so a policy field never forms a name-and-value pair that a secret scanner could mistake for a credential.
   const value={...config,revision:expectedRevision+1};value.version=digest(Object.fromEntries(['authorization','mode','allowed','rules','sources'].map(name=>[name,value[name]])));
   this.put('config','current',value);if(old&&old.version!==value.version)this.engine.policyChanged(old.version,value.version,new Map(this.repo.tickets.open().map(t=>[t.id,{requesterAllowed:this.policy().revalidate(t.mandate)}])));return value});
 }
 config(){return this.get('config','current')??{revision:0,version:'unconfigured',mode:'off',allowed:[],rules:[],sources:[],paused:true}}
 count(kind){return this.db.prepare('SELECT COUNT(*) AS n FROM objects WHERE kind=?').get(kind).n;}
 sourceScope(trigger){const c=this.config();return c.sources?.includes(trigger.source)?{listened:true,observed:true}:{listened:false,reason:'sourceNotAuthorized'}}
 policy(){const c=this.config(),enabled=new Set(c.rules.filter(r=>r.enabled).map(r=>r.id));return{version:c.version,paused:c.paused??false,evalTimeoutMs:c.evalTimeoutMs??120000,
  gate:t=>c.allowed.includes(`${t.actor.source}:${t.actor.id}`)&&t.human&&t.addressed?{admissible:true,strength:'explicit',basis:{via:'addressed',source:t.source,scope:t.meta}}:
   c.mode!=='off'&&c.rules.some(r=>r.enabled)&&c.sources.includes(t.source)?{admissible:true,strength:'inferred',basis:{via:'admission',source:t.source,scope:t.meta,observation:true}}:{admissible:false,reason:'notAuthorized'},
  revalidate:m=>m.strength==='explicit'?c.allowed.includes(`${m.actor.source}:${m.actor.id}`):c.mode==='auto'&&!!m.basis.rules?.length&&m.basis.rules.every(r=>enabled.has(r)),
  admitsInferred:rules=>c.mode==='auto'&&rules.length>0&&rules.every(r=>enabled.has(r))};}
 receive(trigger){safeData(trigger);if(!trigger.id||!Array.isArray(trigger.threads)||!trigger.actor||!trigger.at)throw Error('Immutable event identity, actor, timestamp and threads required');trigger={...trigger,at:isoTime(trigger.at)};
  const old=this.repo.triggers.get(trigger.id);if(old&&encode(old)!==encode(trigger))throw Error('An event id cannot be reused with different content');return this.engine.receive(trigger);}
 decide(triggerId,outcome){const candidate=this.engine.candidate(triggerId);if(!candidate)throw Error('No current evaluation');
  if(outcome.kind==='accept'&&candidate.strength==='inferred'){
   const rules=this.config().rules.filter(r=>r.enabled&&outcome.rules?.includes(r.id));if(!rules.length)throw Error('A matching preauthorized rule is required');
   if(this.config().mode==='observe')return this.engine.decide(triggerId,{kind:'ignore',reason:'Observed candidate only',audit:{wouldAccept:true,proposal:outcome}});
   outcome={...outcome,scope:rules.map(r=>r.scope).join('\n')};
  }return this.engine.decide(triggerId,{...outcome,evalId:candidate.evalId});}
 enqueue(kind,id,value){this.db.prepare('INSERT INTO effects(id,kind,value) VALUES(?,?,?) ON CONFLICT(id) DO NOTHING').run(id,kind,encode(value));}
 cancelEffect(id){this.db.prepare("UPDATE effects SET status='cancelled' WHERE id=? AND status='pending'").run(id);}
 claim(kinds){return this.atomic(()=>{const row=this.db.prepare("SELECT * FROM effects WHERE status='pending' AND due<=? ORDER BY CASE kind WHEN 'stop' THEN 0 WHEN 'input' THEN 1 ELSE 2 END,rowid").all(Date.now()).find(x=>kinds.includes(x.kind));if(!row)return;
  const lease=crypto.randomUUID();this.db.prepare("UPDATE effects SET status='running',lease=? WHERE id=? AND status='pending'").run(lease,row.id);return{...row,value:JSON.parse(row.value),lease};});}
 settle(effect,error){return this.atomic(()=>{const row=this.db.prepare('SELECT * FROM effects WHERE id=? AND lease=? AND status=\'running\'').get(effect.id,effect.lease);if(!row)throw Error('Stale effect lease');
  this.db.prepare('UPDATE effects SET status=?,attempts=attempts+1,due=?,lease=NULL,error=? WHERE id=?').run(error?'pending':'done',Date.now()+Math.min(300000,2000*2**Math.min(row.attempts,8)),error?String(error.message??error).slice(0,500):null,effect.id);});}
 recover(){return this.atomic(()=>{for(const row of this.db.prepare("SELECT * FROM effects WHERE status='running'").all()){
   // External delivery may have succeeded before the crash. Preserve ambiguity for channel reconciliation.
   this.db.prepare('UPDATE effects SET status=?,lease=NULL,error=? WHERE id=?').run(row.kind==='reply'?'unknown':'pending','Host restarted; inspect/reconcile before repeating external effects',row.id);
  }for(const ticket of this.repo.tickets.open()){const a=latestAssignment(ticket);if(a?.state==='running')this.engine.assignmentInterrupted(ticket.id,a.id)}});}
 reference(id){const [kind,...parts]=id.split('/');if(!['trigger','thread','ticket','decision','evidence','verification','review','plan','result','execution','frontier-item','frontier-observation','frontier-source','frontier-research','frontier-hypothesis','frontier-study','frontier-lesson'].includes(kind))throw Error('Unknown reference kind');return this.get(kind,parts.join('/'));}
 /** A bounded inline projection for prompts: the six-field object when it fits, else a still-parseable object of the same width whose every cut is marked. Pure and local; no model or network call. */
 context(ticketId,{maxChars=6000}={}){const t=this.repo.tickets.get(ticketId);if(!t)throw Error('Unknown ticket');
  if(!Number.isInteger(maxChars)||maxChars<2)throw Error('An inline context budget must be an integer of at least 2 characters');
  const refs=[`trigger/${t.origin.triggerId}`,...this.repo.threads.list().filter(x=>x.subscriptions.includes(ticketId)).map(x=>`thread/${x.key}`)];
  const full={id:t.id,title:t.title,mandate:t.mandate,latest:latestAssignment(t),inputs:t.inputs.slice(-CONTEXT_INPUT_WINDOW),refs},text=JSON.stringify(full);
  if(text.length<=maxChars)return{text,chars:text.length,keptChars:text.length,truncated:false,read:`ticket/${t.id}`,refs};
  const fitted=fitInlineContext(full,maxChars);
  return{text:fitted.text,chars:text.length,keptChars:fitted.text.length,contentChars:fitted.contentChars,truncated:true,read:`ticket/${t.id}`,refs,caps:fitted.caps,omitted:fitted.omitted};
 }
 status(){const tickets=this.repo.tickets.list().map(t=>({id:t.id,title:t.title,stage:ticketStage(t),ended:t.ended,assignment:latestAssignment(t)?.state}));return{configured:this.config().revision>0,paused:this.config().paused??false,mode:this.config().mode,tickets,needsAttention:tickets.filter(t=>t.stage.stage==='person'),frontier:{sources:this.count('frontier-source'),items:this.count('frontier-item'),research:this.get('frontier-state','current')??null,studies:this.count('frontier-study'),accepted:this.count('frontier-lesson')},effects:this.db.prepare('SELECT kind,status,COUNT(*) AS count FROM effects GROUP BY kind,status').all()};}
 close(){this.db.close()}
}
export function inspectSuperagent(project,options={}){const root=superagentDirectory(project,options.stateRoot);if(!fs.existsSync(path.join(root,'superagent.sqlite')))return{configured:false,automaticExecution:false,tickets:[],needsAttention:[]};const s=new Superagent(project,options);try{return s.status()}finally{s.close()}}
