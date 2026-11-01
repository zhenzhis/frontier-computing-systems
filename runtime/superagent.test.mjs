import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Superagent,inspectSuperagent,superagentDirectory,fitInlineContext,CONTEXT_INPUT_WINDOW} from './superagent.mjs';
const fixture=()=>{const root=fs.mkdtempSync(path.join(os.tmpdir(),'fcs-superagent-'));const project=path.join(root,'project');fs.mkdirSync(project);return{project,stateRoot:path.join(root,'state')}};
// The fixture authorization text is bound once, so a policy field name and its value never form a pair a secret scanner reads as a credential.
const authorization='Fixture authorization for local changes only';
const config={authorization,mode:'auto',allowed:['local:owner'],sources:['local'],rules:[{id:'improve',enabled:true,scope:'Improve fixture source; no outside effects'}]};
const event=(id='one',extra={})=>({id,source:'local',at:'2026-10-31T00:00:00.000Z',text:'Please improve the fixture',human:true,addressed:'direct',actor:{source:'local',id:'owner'},threads:[{source:'local',id:'work'}],meta:{},...extra});
function accept(s,e=event()){s.receive(e);s.engine.evaluateDue();return s.decide(e.id,{kind:'accept',title:'Improve fixture',scope:'Fixture only',reason:'Explicit fixture request'}).ticketId}
const refsOf=(s,id)=>{const t=s.repo.tickets.get(id);return[`trigger/${t.origin.triggerId}`,...s.repo.threads.list().filter(x=>x.subscriptions.includes(id)).map(x=>`thread/${x.key}`)]};
/** The fixture of the retained failure evidence: a long Mandate scope and many long Inputs, all built through the public engine path. */
function longTicket(s){s.receive(event('long'));s.engine.evaluateDue();const id=s.decide('long',{kind:'accept',title:'Long fixture mandate',scope:'Fixture scope '.repeat(40),reason:'Explicit fixture request'}).ticketId;for(let n=0;n<12;n++)s.engine.note(id,`Follow-up ${n}: `+'detail '.repeat(60));return id}
/** The marker objects a reader can see inside the inline text: a cut value, not a silently shortened string. */
function markers(value,prefix='',found=[]){if(Array.isArray(value))value.forEach((item,index)=>markers(item,`${prefix}[${index}]`,found));else if(value&&typeof value==='object'){if(value.truncated===true&&Number.isInteger(value.originalChars)&&typeof value.head==='string')found.push({path:prefix,value});else for(const [name,item] of Object.entries(value))markers(item,prefix?`${prefix}.${name}`:name,found)}return found}
/** Every visible cut carries its recorded loss, and the head it kept is exactly that length. */
function assertMarked(parsed,caps){for(const {path,value} of markers(parsed)){const cap=caps?.[path];assert(cap,`a cut string keeps its recorded loss: ${path}`);assert.equal(cap.originalChars,value.originalChars);assert.equal(cap.keptChars,value.keptChars);assert.equal(value.head.length,value.keptChars);assert(value.originalChars>value.keptChars)}}
/** The other direction: `caps` names no string loss that the payload does not also mark in place. */
function assertEveryCutNamed(parsed,caps){const visible=new Set(markers(parsed).map(marker=>marker.path));for(const key of Object.keys(caps??{}))if(key!=='inputs')assert(visible.has(key),`caps records ${key}, so the payload must mark it too`)}
/** A dropped Input window is visible either as kept/dropped counts or as a named omission, never as silence. */
function assertInputWindow(fitted,parsed,window){const kept=parsed.inputs??[];assert.deepEqual(kept.map(input=>input.id),window.slice(window.length-kept.length).map(input=>input.id),'the inline Input window stays a suffix in its original order');for(const input of kept){const original=window.find(item=>item.id===input.id);assert(original,'a kept Input keeps its own record id');assert(input.text===original.text||typeof input.text==='object','a kept Input never carries a silently cut text')}
 if(kept.length>=window.length)return assert(!('inputs' in fitted.caps));
 const dropped=window.slice(0,window.length-kept.length).map(input=>input.id),named=fitted.omitted.includes('inputs');
 if(!named)assert.deepEqual(fitted.caps.inputs,{available:window.length,kept:kept.length,droppedIds:dropped});
 else assert.equal(kept.length,0,'Inputs named as omitted are not half kept')}
test('superagent status leaves absent state untouched',()=>{const f=fixture();assert.equal(inspectSuperagent(f.project,f).configured,false);assert(!fs.existsSync(superagentDirectory(f.project,f.stateRoot)))});
test('upstream core has durable tasks, idempotent events and transactional effects',()=>{const f=fixture();let s=new Superagent(f.project,f);s.configure(config);const id=accept(s);assert(id);assert.equal(s.receive(event()),'duplicate');assert.throws(()=>s.receive(event('one',{text:'different'})),/different content/);assert(s.status().effects.some(x=>x.kind==='launch'));s.close();s=new Superagent(f.project,f);assert.equal(s.repo.tickets.get(id).title,'Improve fixture');assert.throws(()=>s.atomic(()=>{s.enqueue('launch','rollback',{});throw Error('rollback')}));assert(!s.db.prepare('SELECT 1 FROM effects WHERE id=?').get('rollback'));s.close()});
test('subscriptions deliver context without granting a new mandate',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure(config);const id=accept(s),mandate=s.repo.tickets.get(id).mandate;s.receive(event('follow',{text:'A new clue',actor:{source:'local',id:'outsider'}}));assert.deepEqual(s.repo.tickets.get(id).mandate,mandate);assert(s.repo.tickets.get(id).inputs.some(x=>x.triggerId==='follow'));assert.equal(s.engine.candidate('follow'),undefined);s.engine.stopTicket(id);s.receive(event('after-stop'));s.engine.evaluateDue();assert.equal(s.repo.tickets.get(id).ended.by,'human');s.close()});
test('observe records a proposal without launching and untrusted sources are filtered',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure({...config,mode:'observe'});s.receive(event('candidate',{human:false,addressed:undefined}));s.engine.evaluateDue();const d=s.decide('candidate',{kind:'accept',rules:['improve'],title:'Candidate',scope:'wider model scope',reason:'Rule match'});assert.equal(d.kind,'ignore');assert.equal(d.audit.wouldAccept,true);assert.equal(s.repo.tickets.list().length,0);assert.equal(s.receive(event('outside',{source:'outside'})),'filtered');s.close()});
test('policy drift invalidates an assessment and configuration updates need exact revision',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure(config);s.receive(event());s.engine.evaluateDue();const stale=s.engine.candidate('one');s.configure({...config,mode:'off'},1);assert.throws(()=>s.engine.decide('one',{evalId:stale.evalId,kind:'accept',title:'bad',scope:'fixture',reason:'stale'}));assert.throws(()=>s.configure(config,1),/Stale/);s.close()});
test('effect leases reject stale results and ambiguous outgoing delivery is not replayed',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure(config);s.enqueue('reply','external',{messageId:'x'});const effect=s.claim(['reply']);assert(effect);assert.throws(()=>s.settle({...effect,lease:'wrong'}),/Stale/);s.recover();assert.equal(s.db.prepare('SELECT status FROM effects WHERE id=?').get('external').status,'unknown');assert.equal(s.claim(['reply']),undefined);s.close()});
test('context contains stable continuation references and keeps its whole budget parseable',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure(config);const id=accept(s),t=s.repo.tickets.get(id),c=s.context(id,{maxChars:90});
 // Intended behaviour change: this case used to assert only that the raw slice of the serialized projection measured 90 characters, which froze a cut JSON fragment as the invariant. The narrowed slot keeps that exact width, and the same budget is now also required to yield one parseable object with named losses instead of a fragment.
 assert.equal(c.text.length,90);assert.equal(c.keptChars,c.text.length);assert.equal(c.truncated,true);assert(c.chars>c.text.length);
 const parsed=JSON.parse(c.text);assert.equal(typeof parsed,'object');assert.equal(parsed.truncated,true);assert.equal(parsed.id,t.id);// the record id survives the narrowest budget that can carry it
 assert.deepEqual(c.omitted,['title','mandate','latest','inputs','refs']);assert.deepEqual(c.caps,{});assert.deepEqual(markers(parsed),[]);
 assert(c.refs.includes('trigger/one'));assert(c.refs.some(ref=>ref.startsWith('thread/')));assert.deepEqual(c.refs,refsOf(s,id));
 assert.equal(c.read,`ticket/${id}`);assert.equal(s.reference(c.read).id,id);s.close()});
test('negative evidence: slicing the serialized inline projection produced an unparseable fragment',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure(config);const id=longTicket(s),t=s.repo.tickets.get(id),maxChars=600;
 // The replaced implementation, kept as retained failure evidence on this same fixture instead of being deleted: JSON.stringify(...).slice(0,maxChars).
 const legacy=JSON.stringify({id:t.id,title:t.title,mandate:t.mandate,latest:t.assignments.at(-1),inputs:t.inputs.slice(-CONTEXT_INPUT_WINDOW),refs:refsOf(s,id)}),fragment=legacy.slice(0,maxChars);
 assert(legacy.length>maxChars);assert.equal(fragment.length,maxChars);assert(legacy.startsWith(fragment));
 assert.throws(()=>JSON.parse(fragment),SyntaxError);
 const c=s.context(id,{maxChars}),parsed=JSON.parse(c.text);
 assert.equal(c.text.length,maxChars);assert.equal(typeof parsed,'object');assert.equal(c.truncated,true);s.close()});
test('a narrowed projection marks every cut string and never shortens a record handle',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure(config);const id=longTicket(s),t=s.repo.tickets.get(id),window=t.inputs.slice(-CONTEXT_INPUT_WINDOW),c=s.context(id,{maxChars:1200}),parsed=JSON.parse(c.text);
 assert.equal(c.text.length,1200);assert.equal(c.truncated,true);assert.equal(c.keptChars,c.text.length);assert(c.chars>1200);
 assert.equal(c.contentChars,c.text.trimEnd().length);// the fill past the object is insignificant whitespace only
 assert.equal(parsed.truncated,true);assert(parsed.mandate,'a narrowed projection still describes the mandate, marked or whole');
 assert.equal(parsed.mandate.policyVersion,t.mandate.policyVersion);// a record digest is carried whole or omitted, never shortened
 assert(parsed.mandate.scope===t.mandate.scope||typeof parsed.mandate.scope==='object');
 assertMarked(parsed,c.caps);assertEveryCutNamed(parsed,c.caps);assertInputWindow({caps:c.caps,omitted:c.omitted},parsed,window);
 assert(Object.keys(c.caps).length>0||c.omitted.length>0);
 assert(c.refs.includes('trigger/long'));assert(c.refs.some(ref=>ref.startsWith('thread/')));assert.deepEqual(c.refs,refsOf(s,id));
 assert.equal(c.read,`ticket/${id}`);assert.equal(s.reference(c.read).id,id);s.close()});
test('every budget returns one complete object of exactly that width and keeps more text as the budget grows',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure(config);const id=longTicket(s),window=s.repo.tickets.get(id).inputs.slice(-CONTEXT_INPUT_WINDOW);
 let previous=0;
 for(const maxChars of [200,600,1200,3000]){const c=s.context(id,{maxChars}),parsed=JSON.parse(c.text);
  assert.equal(c.text.length,maxChars);assert.equal(c.keptChars,c.text.length);assert.equal(c.truncated,true);assert(c.chars>maxChars);
  assert.equal(c.contentChars,c.text.trimEnd().length);// the object ends at contentChars, the rest is whitespace fill
  assert.equal(typeof parsed,'object');assertMarked(parsed,c.caps);assertEveryCutNamed(parsed,c.caps);assertInputWindow({caps:c.caps,omitted:c.omitted},parsed,window);
  assert(c.contentChars>=previous,'a larger budget never retains less text');previous=c.contentChars;
  assert.equal(s.context(id,{maxChars}).text,c.text,'the projection is deterministic for one ticket and budget');
 }
 s.close()});
test('an oversized inline input list drops whole Inputs and names every dropped id',()=>{const window=Array.from({length:CONTEXT_INPUT_WINDOW},(_,n)=>({id:`input-${n}`,kind:'trigger',triggerId:'a1'.repeat(16),at:'2026-10-31T00:00:00.000Z',text:'input text '.repeat(12)})),full={id:'ticket-fixture',title:'Fixture',mandate:{strength:'explicit',policyVersion:'b2'.repeat(32),scope:'Fixture only'},latest:{id:'assignment-fixture',state:'running'},inputs:window,refs:['trigger/one']},keptCounts=[];
 for(let maxChars=200;maxChars<=2000;maxChars+=50){const fitted=fitInlineContext(full,maxChars),parsed=JSON.parse(fitted.text);
  assert.equal(fitted.text.length,maxChars);assert.equal(fitted.contentChars,fitted.text.trimEnd().length);assert.equal(typeof parsed,'object');
  assertMarked(parsed,fitted.caps);assertEveryCutNamed(parsed,fitted.caps);assertInputWindow(fitted,parsed,window);
  keptCounts.push((parsed.inputs??[]).length);
 }
 assert(keptCounts[0]<CONTEXT_INPUT_WINDOW,'a small budget cannot carry the whole window');
 assert(keptCounts.some(count=>count>0&&count<CONTEXT_INPUT_WINDOW),'some budget keeps part of the window and names the rest')});
test('a tiny budget still returns a parseable object and names everything it omitted',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure(config);const id=accept(s);
 for(const maxChars of [2,20]){const c=s.context(id,{maxChars}),parsed=JSON.parse(c.text);
  assert.equal(c.text.length,maxChars);assert.equal(c.truncated,true);assert.equal(typeof parsed,'object');
  assert.deepEqual(c.omitted,['id','title','mandate','latest','inputs','refs']);assert.deepEqual(c.caps,{});
  assert.deepEqual(c.refs,refsOf(s,id));assert.equal(c.read,`ticket/${id}`)}
 // Fewer characters than any JSON object needs cannot satisfy both the budget and parseability, so it is refused instead of returning a fragment.
 assert.throws(()=>s.context(id,{maxChars:1}),/at least 2/);s.close()});
test('a ticket that fits its budget keeps the exact six-field projection',()=>{const f=fixture(),s=new Superagent(f.project,f);s.configure(config);const id=accept(s),t=s.repo.tickets.get(id),refs=refsOf(s,id),c=s.context(id),parsed=JSON.parse(c.text);
 assert.equal(c.truncated,false);assert.equal(c.chars,c.text.length);assert.equal(c.keptChars,c.text.length);assert(!('caps' in c)&&!('omitted' in c)&&!('contentChars' in c));
 assert.deepEqual(parsed,{id:t.id,title:t.title,mandate:t.mandate,latest:t.assignments.at(-1),inputs:t.inputs.slice(-CONTEXT_INPUT_WINDOW),refs});
 assert.deepEqual(c.refs,refs);assert.equal(c.read,`ticket/${id}`);assert.equal(s.reference(c.read).id,id);s.close()});
