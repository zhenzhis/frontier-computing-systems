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
   const value={...config,revision:expectedRevision+1};value.version=digest({authorization:value.authorization,mode:value.mode,allowed:value.allowed,rules:value.rules,sources:value.sources});
   this.put('config','current',value);if(old&&old.version!==value.version)this.engine.policyChanged(old.version,value.version,new Map(this.repo.tickets.open().map(t=>[t.id,{requesterAllowed:this.policy().revalidate(t.mandate)}])));return value});
 }
 config(){return this.get('config','current')??{revision:0,version:'unconfigured',mode:'off',allowed:[],rules:[],sources:[],paused:true}}
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
 reference(id){const [kind,...parts]=id.split('/');if(!['trigger','thread','ticket','decision','evidence','verification','review','plan','result','execution'].includes(kind))throw Error('Unknown reference kind');return this.get(kind,parts.join('/'));}
 context(ticketId,{maxChars=6000}={}){const t=this.repo.tickets.get(ticketId);if(!t)throw Error('Unknown ticket');const refs=[`trigger/${t.origin.triggerId}`,...this.repo.threads.list().filter(x=>x.subscriptions.includes(ticketId)).map(x=>`thread/${x.key}`)];
  const text=JSON.stringify({id:t.id,title:t.title,mandate:t.mandate,latest:latestAssignment(t),inputs:t.inputs.slice(-8),refs});return{text:text.slice(0,maxChars),chars:text.length,truncated:text.length>maxChars,read:`ticket/${t.id}`,refs};}
 status(){const tickets=this.repo.tickets.list().map(t=>({id:t.id,title:t.title,stage:ticketStage(t),ended:t.ended,assignment:latestAssignment(t)?.state}));return{configured:this.config().revision>0,paused:this.config().paused??false,mode:this.config().mode,tickets,needsAttention:tickets.filter(t=>t.stage.stage==='person'),effects:this.db.prepare('SELECT kind,status,COUNT(*) AS count FROM effects GROUP BY kind,status').all()};}
 close(){this.db.close()}
}
export function inspectSuperagent(project,options={}){const root=superagentDirectory(project,options.stateRoot);if(!fs.existsSync(path.join(root,'superagent.sqlite')))return{configured:false,automaticExecution:false,tickets:[],needsAttention:[]};const s=new Superagent(project,options);try{return s.status()}finally{s.close()}}
