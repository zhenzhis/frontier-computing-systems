import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawn,execFileSync} from 'node:child_process';
import {Superagent,digest} from './superagent.mjs';
import {runModelRole} from './superagent-model.mjs';
import {latestAssignment} from '../vendor/dsh-superagent-core/index.mjs';
import {projectPath} from './control.mjs';
import {runDshWorker} from './dsh-executor.mjs';
import {inspect} from '../scripts/audit-public.mjs';
import {backup} from '../scripts/backup.mjs';

const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe'],maxBuffer:8*1024*1024}).trim();
export function sourceFingerprint(project){const scope=fs.realpathSync(project),files=[...new Set(git(project,'ls-files','--cached','--others','--exclude-standard','-z').split('\0').filter(Boolean))].filter(file=>fs.existsSync(projectPath(scope,file))).sort();return digest(files.map(file=>[file,crypto.createHash('sha256').update(fs.readFileSync(projectPath(scope,file))).digest('hex')]))}
export function checkedPlan(plan,project){if(!plan||!plan.title||!plan.problem||!plan.acceptance||!Array.isArray(plan.files)||!plan.files.length||plan.files.length>30)throw Error('A bounded plan needs problem evidence, acceptance and assigned files');
 for(const f of plan.files){projectPath(fs.realpathSync(project),f);if(/(^|[\/])(?:\.env(?:\.|$)|auth\.json|models(?:-store)?\.json|settings\.json|node_modules|state|sessions|backups)(?:[\/]|$)/i.test(f))throw Error('Personal configuration and runtime state are outside source ownership')}
 return plan;}
export function acquireWriter(directory,owner,{recoverDead=false}={}){fs.mkdirSync(directory,{recursive:true});const file=path.join(directory,'writer.json');let fd;try{fd=fs.openSync(file,'wx')}catch(error){if(error.code!=='EEXIST'||!recoverDead)throw error;const previous=JSON.parse(fs.readFileSync(file,'utf8'));if(previous.platform!==process.platform)throw error;let dead=false;try{process.kill(previous.pid,0)}catch(e){dead=e.code==='ESRCH'}if(!dead)throw error;fs.renameSync(file,path.join(directory,`dead-${previous.lease}.json`));fd=fs.openSync(file,'wx')}
 const lease=crypto.randomUUID();fs.writeFileSync(fd,JSON.stringify({owner,lease,pid:process.pid,platform:process.platform,at:new Date().toISOString()}));fs.fsyncSync(fd);fs.closeSync(fd);return()=>{const current=JSON.parse(fs.readFileSync(file,'utf8'));if(current.lease!==lease)throw Error('Writer ownership changed');fs.unlinkSync(file)}}
export function command(executable,args,{cwd,log,signal,timeoutMs=600000}={}){return new Promise((resolve,reject)=>{if(signal?.aborted){reject(Error('Execution cancelled before process start'));return}let output='';const env={...process.env};delete env.NODE_TEST_CONTEXT;const child=spawn(executable,args,{cwd,env,windowsHide:true,stdio:['ignore','pipe','pipe'],signal});const timer=setTimeout(()=>child.kill(),timeoutMs);const collect=data=>{const text=data.toString();output=(output+text).slice(-100000);if(log)fs.appendFileSync(log,text)};child.stdout.on('data',collect);child.stderr.on('data',collect);child.on('error',e=>{clearTimeout(timer);reject(e)});child.on('close',(code,termination)=>{clearTimeout(timer);resolve({passed:code===0,code,termination,output})})})}
export function npmCli(){const candidates=[process.env.FCS_NPM_CLI,process.env.npm_execpath?.endsWith('npm-cli.js')?process.env.npm_execpath:null,path.join(path.dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),path.resolve(path.dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')].filter(Boolean);const found=candidates.find(file=>fs.existsSync(file));if(!found)throw Error('Cannot resolve the installed npm CLI; set FCS_NPM_CLI explicitly');return found}
async function npm(cwd,args,options){return command(process.execPath,[npmCli(),...args],{cwd,...options})}
function sourceCopy(from,to){fs.cpSync(from,to,{recursive:true,filter:file=>!path.relative(from,file).split(path.sep).some(x=>['.git','node_modules','.private','.local','state','sessions','backups'].includes(x))})}
function versionCandidate(project,plan,worker){
 const file=path.join(project,'package.json'),pkg=JSON.parse(fs.readFileSync(file,'utf8'));
 const previous=JSON.parse(git(project,'show','HEAD:package.json')).version;
 if(pkg.version!==previous)throw Error('Version changes are owned by the controller');
 const parts=previous.split('.').map(Number);if(parts.length!==3||parts.some(x=>!Number.isInteger(x)))throw Error('Automatic release requires a stable semver');parts[2]++;
 pkg.version=parts.join('.');fs.writeFileSync(file,JSON.stringify(pkg,null,2)+'\n');
 const lockFile=path.join(project,'package-lock.json'),lock=JSON.parse(fs.readFileSync(lockFile,'utf8'));lock.version=pkg.version;lock.packages[''].version=pkg.version;fs.writeFileSync(lockFile,JSON.stringify(lock,null,2)+'\n');
 const changelog=path.join(project,'CHANGELOG.md'),text=fs.readFileSync(changelog,'utf8');const entry=`\n## ${pkg.version} — ${new Date().toISOString().slice(0,10)}\n\n- ${String(worker.summary??plan.title).replace(/\s+/g,' ')}\n`;
 fs.writeFileSync(changelog,text.replace(/^(# [^\n]*\n)/,'$1'+entry));return pkg.version;
}

/** Candidate tests plus the supervisor's frozen regression tests in a separate checkout. */
export async function verifyCandidate(supervisor,candidate,artifacts,signal){fs.mkdirSync(artifacts,{recursive:true});const log=path.join(artifacts,'verification.log');
 const install=await npm(candidate,['ci','--ignore-scripts','--no-audit','--no-fund'],{log,signal});if(!install.passed)return{passed:false,stage:'dependencies',log};
 let result=await command(process.execPath,[path.join(supervisor,'scripts/verify-manifest.mjs'),'--root',candidate,'--write'],{cwd:candidate,log,signal});if(!result.passed)return{passed:false,stage:'manifest',log};
 for(const script of ['verify','verify:sdk']){result=await npm(candidate,['run',script],{log,signal});if(!result.passed)return{passed:false,stage:script,log}}
 for(const name of ['audit-public','verify-links','verify-manifest','verify-sdk']){const file=path.join(supervisor,'scripts',name+'.mjs');if(!fs.existsSync(file))throw Error('Frozen verifier is incomplete: '+name);result=await command(process.execPath,[file,'--root',candidate],{cwd:candidate,log,signal});if(!result.passed)return{passed:false,stage:'frozen-'+name,log}}
 const fixture=path.join(artifacts,'frozen-regression');sourceCopy(candidate,fixture);
 fs.cpSync(path.join(supervisor,'tests'),path.join(fixture,'tests'),{recursive:true});
 for(const file of fs.readdirSync(path.join(supervisor,'runtime'))){if(file.endsWith('.test.mjs'))fs.copyFileSync(path.join(supervisor,'runtime',file),path.join(fixture,'runtime',file))}
 // Dependencies are disposable and shared read-only by convention, not an OS sandbox.
 if(!fs.existsSync(path.join(fixture,'node_modules')))fs.symlinkSync(path.join(candidate,'node_modules'),path.join(fixture,'node_modules'),process.platform==='win32'?'junction':'dir');
 const tests=['runtime','tests'].flatMap(dir=>fs.readdirSync(path.join(fixture,dir)).filter(f=>f.endsWith('.test.mjs')).map(f=>`${dir}/${f}`));
 result=await command(process.execPath,['--test',...tests],{cwd:fixture,log,signal});return{passed:result.passed,stage:'frozen-regression',log,frozenTests:tests.map(f=>({file:f,sha256:digest(fs.readFileSync(path.join(fixture,f),'utf8'))}))};}

/** Publication has a separate, frozen authorization; model text cannot turn it on. */
export async function publishCandidate({project,repository,branch,title,body,artifacts,signal,autoMerge=false,backupRoot,expectedFingerprint},authorize){if(!authorize('publish'))throw Error('Publication is not authorized');
 const guard=action=>{if(signal?.aborted||!authorize(action))throw Error('Publication authorization withdrawn')};guard('publish');
 if(inspect('publication.md',title+'\n'+body).length)throw Error('Public message failed privacy checks');if(expectedFingerprint&&sourceFingerprint(project)!==expectedFingerprint)throw Error('Reviewed candidate changed before publication');
 const log=path.join(artifacts,'publication.log'),bodyFile=path.join(artifacts,'pr-body.md');fs.writeFileSync(bodyFile,body);
 const stateFile=path.join(artifacts,'publication-state.json');let state=fs.existsSync(stateFile)?JSON.parse(fs.readFileSync(stateFile,'utf8')):null;
 const save=patch=>{state={...state,...patch};const tmp=stateFile+'.tmp';fs.writeFileSync(tmp,JSON.stringify(state,null,2));fs.renameSync(tmp,stateFile)};
 if(state&&(state.repository!==repository||state.branch!==branch))throw Error('Publication recovery identity mismatch');
 if(!state){git(project,'add','--all');if(git(project,'diff','--cached','--name-only'))git(project,'commit','-m',title);save({repository,branch,commit:git(project,'rev-parse','HEAD'),stage:'committed'});}
 const commit=state.commit;if(git(project,'rev-parse','HEAD')!==commit)throw Error('Candidate HEAD changed during publication recovery');
 if(backupRoot&&!state.backup){const receipt=backup(project,backupRoot,{apply:true});save({backup:receipt.folder})}
 let r;const remote=await command('git',['ls-remote','origin',`refs/heads/${branch}`],{cwd:project,log,signal});if(!remote.passed)throw Error('Cannot reconcile remote branch');const remoteSha=remote.output.trim().split(/\s+/)[0];if(remoteSha&&remoteSha!==commit)throw Error('Remote branch differs; refuse overwrite');
 if(!remoteSha&&!state.number){guard('publish');save({stage:'push-intent'});r=await command('git',['push','origin',`HEAD:refs/heads/${branch}`],{cwd:project,log,signal});if(!r.passed)throw Error('Candidate push outcome requires reconciliation');save({stage:'pushed'})}
 if(!state.number){const listed=await command('gh',['pr','list','--repo',repository,'--head',branch,'--state','all','--json','number,url,headRefOid,state'],{cwd:project,log,signal});if(!listed.passed)throw Error('Cannot reconcile existing pull requests');const found=JSON.parse(listed.output).find(x=>x.headRefOid===commit);if(found)save({number:found.number,url:found.url,stage:found.state==='MERGED'?'merged':'pull-request'});else{
  guard('publish');save({stage:'pr-intent'});r=await command('gh',['pr','create','--repo',repository,'--base','main','--head',branch,'--title',title,'--body-file',bodyFile],{cwd:project,log,signal});if(!r.passed)throw Error('PR creation outcome requires reconciliation');const url=r.output.trim().split(/\r?\n/).at(-1),number=Number(url?.match(/\/pull\/(\d+)/)?.[1]);if(!number)throw Error('PR identity was not returned');save({url,number,stage:'pull-request'})}}
 const {url,number}=state;const current=JSON.parse(execFileSync('gh',['pr','view',String(number),'--repo',repository,'--json','state,headRefOid'],{encoding:'utf8'}));if(current.state==='MERGED'){save({stage:'merged'});return{commit,url,number,merged:true}}if(current.state!=='OPEN'||current.headRefOid!==commit)throw Error('PR state/head changed; refuse automatic replay');
 if(!autoMerge)return{commit,url,number,merged:false};
 const deadline=Date.now()+30*60000;let passed=false;
 while(Date.now()<deadline){if(signal?.aborted||!authorize('merge'))throw Error('Merge authorization withdrawn');
  const run=await command('gh',['run','list','--repo',repository,'--commit',commit,'--workflow','verify.yml','--json','headSha,status,conclusion','--limit','10'],{cwd:project,log,signal});if(run.passed){const rows=JSON.parse(run.output);const latest=rows.find(x=>x.headSha===commit);if(latest?.status==='completed'){if(latest.conclusion!=='success')throw Error('Exact-commit CI failed');passed=true;break}}
  await new Promise(resolve=>setTimeout(resolve,10000));
 }if(!passed)throw Error('Exact-commit CI did not finish within this attempt');
 const head=JSON.parse(execFileSync('gh',['pr','view',String(number),'--repo',repository,'--json','headRefOid'],{encoding:'utf8'}));if(head.headRefOid!==commit)throw Error('PR head changed after validation');
 guard('merge');save({stage:'merge-intent'});r=await command('gh',['pr','merge',String(number),'--repo',repository,'--squash','--match-head-commit',commit,'--delete-branch'],{cwd:project,log,signal});if(!r.passed)throw Error('Merge outcome requires reconciliation');save({stage:'merged'});return{commit,url,number,merged:true};}

export class Autopilot {
 constructor(project,config,{stateRoot,runRole=runModelRole,verify=verifyCandidate,publish=publishCandidate}={}){if(!config.authorization||!config.provider||!config.model||!config.agentDir)throw Error('Autopilot requires explicit authorization and an exact model channel');this.config=config;this.store=new Superagent(project,{stateRoot});this.runRole=runRole;this.verify=verify;this.publish=publish;this.running=new Map();this.pending=new Set();this.stopping=false;}
 authorize(action){const c=this.store.config();return!this.stopping&&!c.paused&&c.authorization===this.config.authorization&&((action==='publish'&&this.config.publish===true)||(action==='merge'&&this.config.autoMerge===true)||action==='local')}
 record(kind,value){this.store.atomic(()=>this.store.put(kind,crypto.randomUUID(),{at:new Date().toISOString(),...value}))}
 async role(role,project,prompt,options={}){return this.runRole({project,agentDir:this.config.agentDir,provider:this.config.provider,model:this.config.model,role,prompt,stateDir:this.store.root,
  onUsage:usage=>this.record('usage',{role,usage,requestedModel:this.config.model}),onProgress:p=>this.record('progress',{role,...p}),contextRead:id=>this.store.reference(id),signal:AbortSignal.timeout((this.config.cycleMinutes??30)*60000),...options})}
 discover(){const c=this.store.config();if(c.paused||c.mode!=='auto'||this.running.size||this.store.repo.tickets.open().length)return;const revision=git(this.store.project,'rev-parse','HEAD');const id=`discovery-${revision.slice(0,12)}-${Math.floor(Date.now()/(this.config.discoverySeconds??900)/1000)}`;
  this.store.receive({id,source:'repository',threads:[{source:'repository',id}],actor:{source:'repository',id:'scanner'},human:false,at:new Date().toISOString(),text:'Inspect the current repository, roadmap and recorded failures. Propose one reproducible, useful, bounded improvement, or ignore when evidence is insufficient. Do not manufacture activity.',meta:{revision}});}
 async assess(effect){const {triggers}=effect.value,trigger=triggers[0];this.store.engine.candidateDelivered(effect.id);
  this.assessController=new AbortController();try{
  const decision=await this.role('router',this.store.project,`Assess ALL events in this batch against the explicit authorization ${this.config.authorization}. Enabled rules: ${JSON.stringify(this.store.config().rules)}. Return fcs_report {kind:'accept'|'ignore'|'stop',ticketId?:string,title,problem,acceptance,files:[relative paths],reason,rules:[matching rule ids],coveredTriggerIds:[every event id]}. One decision covers the entire upstream evaluation batch; do not silently omit a request. Explicit human stop requests take priority and name an existing ticket. Open tickets: ${JSON.stringify(this.store.status().tickets.filter(t=>!t.ended))}. Acceptance must name observable outcomes. Inspect files before proposing an improvement; keep negative evidence. Events: ${JSON.stringify(triggers)}`,{signal:AbortSignal.any([this.assessController.signal,AbortSignal.timeout((this.config.cycleMinutes??30)*60000)])});
  if(!this.authorize('local'))throw Error('Assessment paused or authorization changed');
  if(triggers.length>1&&triggers.some(t=>!decision.coveredTriggerIds?.includes(t.id)))throw Error('Router did not account for the complete evaluation batch');
  if(decision.kind==='stop'){this.store.decide(trigger.id,{kind:'stop',ticketId:decision.ticketId,reason:decision.reason??'Explicit human stop'});return}
  if(decision.kind!=='accept'){this.store.decide(trigger.id,{kind:'ignore',reason:decision.reason??'Insufficient evidence'});return}
  const plan=checkedPlan(decision,this.store.project);const d=this.store.decide(trigger.id,{kind:'accept',title:plan.title,scope:this.config.scope,reason:plan.reason??plan.problem,rules:plan.rules});if(d.ticketId)this.store.atomic(()=>this.store.put('plan',d.ticketId,plan));
  }finally{this.assessController=null}}
 async adopt(receipt,signal){
  const {worktree,branch,plan,artifacts}=receipt;const authorized=action=>this.authorize(action)&&!signal?.aborted&&!this.store.repo.tickets.get(receipt.ticketId)?.ended;if(!authorized('local'))throw Error('Authorization changed before adoption');
  if(sourceFingerprint(worktree)!==receipt.fingerprint)throw Error('Validated candidate changed before adoption');
  if(this.config.localDeployment&&!receipt.deployment){const d=this.config.localDeployment,values={candidate:worktree,artifacts};
   const args=d.args.map(arg=>arg.replace(/\{(candidate|artifacts)\}/g,(_,key)=>values[key]));
   const r=await command(d.executable,args,{cwd:this.store.project,log:path.join(artifacts,'adoption.log'),signal});if(!r.passed)throw Error('Active local deployment failed; publication is held');
   const deployed=JSON.parse(fs.readFileSync(path.join(artifacts,'deployment.json'),'utf8'));const hash=crypto.createHash('sha256').update(fs.readFileSync(path.join(worktree,'release-manifest.json'))).digest('hex');if(!deployed.passed||deployed.manifestSha256!==hash)throw Error('Local deployment receipt does not match candidate');receipt.deployment=deployed;this.store.atomic(()=>this.store.put('candidate',receipt.ticketId,receipt));
  }
  if(this.config.publish){receipt.publication=await this.publish({project:worktree,repository:this.config.repository,branch,title:plan.title,body:`${plan.problem}\n\n${receipt.worker.summary}\n\nValidation: candidate verify, isolated SDK loading, frozen regression tests and a fresh automated review.\n\nAutomated FCS iteration; model outputs and test evidence are retained privately.`,artifacts,signal,autoMerge:this.config.autoMerge,backupRoot:this.config.backupRoot,expectedFingerprint:receipt.fingerprint},authorized);receipt.status=receipt.publication.merged?'merged':'pull-request';this.store.atomic(()=>this.store.put('candidate',receipt.ticketId,receipt));
   if(receipt.publication.merged&&this.config.updateAfterMerge){const log=path.join(artifacts,'adoption.log');let r=await command('git',['fetch','origin','main'],{cwd:this.store.project,log,signal});if(!r.passed)throw Error('Merged result retained; main fetch needs retry');const remote=git(this.store.project,'rev-parse','origin/main');if(remote===receipt.base)throw Error('Merged main has not advanced yet; reconciliation needs retry');if(git(this.store.project,'status','--porcelain'))throw Error('Active source checkout changed; refusing to overwrite');r=await command('git',['merge','--ff-only','origin/main'],{cwd:this.store.project,log,signal});if(!r.passed)throw Error('Merged result retained; source fast-forward needs reconciliation');receipt.adoptedCommit=git(this.store.project,'rev-parse','HEAD');if(receipt.adoptedCommit!==remote)throw Error('Active source differs from fetched main');
    if(this.config.autoRelease)await this.release(receipt,signal);
   }
  }
  this.store.atomic(()=>this.store.put('result',receipt.ticketId,receipt));this.store.engine.report(receipt.ticketId,{state:'ready',summary:JSON.stringify({status:receipt.status,acceptance:plan.acceptance,url:receipt.publication?.url})});
 }
 progress(ticket,item,value){item.lastProgress=Date.now();this.record('progress',{ticketId:ticket.id,...value});if(value.calls&&item.readPending?.size&&item.session&&!item.session.getSteeringMessages().length&&!this.store.repo.tickets.get(ticket.id)?.ended){this.store.engine.inputsRead(ticket.id,[...item.readPending]);item.readPending.clear()}}
 async release(receipt,signal){
  if(!this.config.backupRoot)throw Error('Formal releases require a source backup destination');const log=path.join(receipt.artifacts,'release.log'),head=receipt.adoptedCommit,project=this.store.project;
  const deadline=Date.now()+30*60000;let passed=false;while(Date.now()<deadline){if(!this.authorize('merge'))throw Error('Release authorization withdrawn');const r=await command('gh',['run','list','--repo',this.config.repository,'--commit',head,'--workflow','verify.yml','--json','headSha,status,conclusion','--limit','10'],{cwd:project,log,signal});if(r.passed){const latest=JSON.parse(r.output).find(x=>x.headSha===head);if(latest?.status==='completed'){if(latest.conclusion!=='success')throw Error('Merged exact-commit CI failed');passed=true;break}}await new Promise(r=>setTimeout(r,10000))}if(!passed)throw Error('Merged exact-commit CI is not ready');
  const version=JSON.parse(fs.readFileSync(path.join(project,'package.json'),'utf8')).version,tag=`v${version}`,existing=git(project,'tag','--list',tag);
  if(existing){if(git(project,'rev-list','-n','1',tag)!==head)throw Error('Existing release tag differs; never rewrite');const remote=git(project,'ls-remote','origin',`refs/tags/${tag}`);if(!remote){const r=await command('git',['push','origin',tag],{cwd:project,log,signal});if(!r.passed)throw Error('Release tag push requires reconciliation')}}else{const r=await command(process.execPath,[path.join(project,'scripts/release.mjs'),'--backup-dir',this.config.backupRoot,'--apply','--push'],{cwd:project,log,signal});if(!r.passed)throw Error('Formal release requires reconciliation')}
  receipt.release={tag,commit:head};
 }
 async execute(effect){const ticket=this.store.repo.tickets.get(effect.value.ticketId);if(!ticket||ticket.ended||latestAssignment(ticket)?.id!==effect.value.assignmentId)return;
  if(!this.authorize('local'))throw Error('Autopilot is paused or authorization changed');
  const release=acquireWriter(this.config.coordinationRoot??this.store.root,`pi:${ticket.id}`,{recoverDead:true}),controller=new AbortController();const timeout=setTimeout(()=>controller.abort(),(this.config.cycleMinutes??30)*60000);
  const item={controller,lastProgress:Date.now(),session:null};this.running.set(ticket.id,item);
  const artifacts=path.join(this.store.root,'runs',latestAssignment(ticket).id);fs.mkdirSync(artifacts,{recursive:true});
  try{
   this.store.engine.assignmentStarted(ticket.id,latestAssignment(ticket).id);
   const validated=this.store.get('candidate',ticket.id);if(validated){await this.adopt(validated,controller.signal);return}
   const base=git(this.store.project,'rev-parse','HEAD'),branch=`${this.config.branchPrefix??'fcs-auto/'}${ticket.id.slice(-20)}-${Date.now().toString(36)}`;
   const worktree=path.join(artifacts,'candidate');git(this.store.project,'worktree','add','-b',branch,worktree,base);
   const plan=this.store.get('plan',ticket.id)??checkedPlan(await this.role('planner',worktree,`Plan the authorized task. Context: ${JSON.stringify(this.store.context(ticket.id))}. Return fcs_report {title,problem,acceptance,files}.`,{signal:controller.signal}),worktree);
   this.store.atomic(()=>this.store.put('execution',ticket.id,{worktree,branch,base,artifacts,plan,status:'working'}));
   let worker,verification;
   for(let round=0;round<3;round++){
    const workerPrompt=`Implement this authorized plan: ${JSON.stringify(plan)}. Exact writable files: ${JSON.stringify(plan.files)}. ${round?`Previous independent checks failed: ${JSON.stringify(verification)}. Repair the same scope; failure evidence: ${JSON.stringify(this.store.get('evidence',`verification/${ticket.id}`))}.`:''} Read AGENTS.md and relevant evidence first. Tests and publication are performed by the controller. Return fcs_report {summary,completed,remaining,handback?:[trigger ids]}.`;
    const useDsh=this.config.dsh&&(this.config.workerEngine==='dsh'||(this.config.workerEngine==='alternate'&&this.store.list('result').length%2===0));
    worker=useDsh?await runDshWorker({...this.config.dsh,nativeTicketId:ticket.id,project:worktree,base,sourceRepository:this.store.project,plan,prompt:workerPrompt,signal:controller.signal,onProgress:p=>this.progress(ticket,item,p)}):await this.role('worker',worktree,workerPrompt,{files:plan.files,signal:controller.signal,onSession:s=>{item.session=s},onProgress:p=>this.progress(ticket,item,p)});
    item.session=null;for(const id of worker.handback??[]){const current=this.store.repo.tickets.get(ticket.id);if(current.inputs.some(input=>input.kind==='trigger'&&input.triggerId===id))try{this.store.engine.handback(ticket.id,id,'Worker found request outside mandate')}catch(error){this.record('failure',{ticketId:ticket.id,handback:id,error:String(error.message)})}else this.record('evidence',{ticketId:ticket.id,unreachedHandback:id})}
    const changed=[...new Set([...git(worktree,'diff','--name-only').split('\n'),...git(worktree,'ls-files','--others','--exclude-standard').split('\n')].filter(Boolean))];if(changed.some(f=>f!=='release-manifest.json'&&!plan.files.includes(f)))throw Error('Candidate changed files outside assigned ownership');if(!changed.filter(f=>f!=='release-manifest.json').length)throw Error('No source change was produced');
    verification=await this.verify(this.config.trustedRoot??this.store.project,worktree,path.join(artifacts,`check-${round}`),controller.signal);this.store.atomic(()=>this.store.put('verification',`${ticket.id}/${round}`,verification));
    if(verification.passed)break;
    this.store.atomic(()=>this.store.put('evidence',`verification/${ticket.id}`,{...verification,tail:verification.log&&fs.existsSync(verification.log)?fs.readFileSync(verification.log,'utf8').slice(-14000):''}));
   }
   if(!verification?.passed)throw Error('Candidate failed independent engineering checks after bounded repairs');
   if(this.config.autoVersion){versionCandidate(worktree,plan,worker);verification=await this.verify(this.config.trustedRoot??this.store.project,worktree,path.join(artifacts,'version-check'),controller.signal);if(!verification.passed)throw Error('Versioned candidate failed independent engineering checks')}
   git(worktree,'add','--intent-to-add','--all');const diff=git(worktree,'diff','--','.',':(exclude)release-manifest.json');if(diff.length>70000)throw Error('Candidate diff exceeds the automatic review bound; split into smaller tasks');const changedFiles=git(worktree,'diff','--name-only');const review=await this.role('reviewer',worktree,`Review independently in a fresh session. Task: ${JSON.stringify(plan)}. Actual worker report: ${JSON.stringify(worker)}. Changed/new files: ${changedFiles}. Complete source diff (manifest omitted): ${diff}. Inspect new files as well. Check source and observable acceptance. The controller's frozen regression checks passed. Return fcs_report {approved:boolean,reason,findings:[...]}. Do not approve based only on a successful process exit.`,{signal:controller.signal});
   this.store.atomic(()=>this.store.put('review',ticket.id,review));if(review.approved!==true)throw Error(`Review rejected candidate: ${review.reason}`);
   if(!this.authorize('local'))throw Error('Authorization changed before adoption');
   const receipt={ticketId:ticket.id,base,branch,worktree,plan,artifacts,verification,review,worker,model:this.config.model,status:'validated',fingerprint:sourceFingerprint(worktree)};this.store.atomic(()=>this.store.put('candidate',ticket.id,receipt));await this.adopt(receipt,controller.signal);
  }catch(error){this.record('failure',{ticketId:ticket.id,error:String(error.message)});const t=this.store.repo.tickets.get(ticket.id),permanent=/changed before adoption|changed before publication|Public message failed|Remote branch differs|PR state\/head changed|Exact-commit CI failed|Existing release tag differs|source backup destination/.test(error.message);if(t&&!t.ended&&(!this.store.get('candidate',ticket.id)||permanent)){this.store.engine.report(ticket.id,{state:'failed',summary:String(error.message).slice(0,1000)});this.store.engine.report(ticket.id,{state:'dropped',summary:'Unaccepted candidate preserved with failure evidence; a later discovery may propose a different repair.'})}throw error}
  finally{clearTimeout(timeout);this.running.delete(ticket.id);release()}}
 async tick(){if(this.stopping||this.store.config().paused){this.cancelCurrent();return}this.discover();this.store.engine.evaluateDue();
  for(const kind of ['stop','input','assess','launch','reply']){
   if((kind==='launch'&&this.running.size)||(kind==='assess'&&this.pending.has('assess')))continue;
   const effect=this.store.claim([kind]);if(!effect)continue;
   try{
   if(kind==='stop'){this.running.get(effect.value.ticketId)?.controller.abort();this.store.settle(effect);continue}
   if(kind==='input'){const t=this.store.repo.tickets.get(effect.value.ticketId),item=this.running.get(t?.id);if(!t||t.ended||!t.undelivered.length)this.store.settle(effect);else if(item?.session){const inputs=t.inputs.filter(x=>t.undelivered.includes(x.id));await item.session.steer(`New task context, no additional authority: ${JSON.stringify(inputs)}`);this.store.engine.inputsDelivered(t.id,effect.value.assignmentId,inputs.map(x=>x.id));item.readPending??=new Set();for(const input of inputs)item.readPending.add(input.id);this.store.settle(effect)}else this.store.settle(effect,Error('Executor not ready'));continue}
   if(kind==='reply'){const receipt=this.store.get('receipt',effect.value.messageId);if(receipt)this.store.atomic(()=>this.store.put('receipt',receipt.id,{...receipt,status:'sent',channelDelivery:'local-panel'}));this.store.settle(effect);continue}
   this.pending.add(kind);void(kind==='assess'?this.assess(effect):this.execute(effect)).then(()=>this.store.settle(effect)).catch(error=>{this.record('failure',{effectId:effect.id,error:String(error.message)});const ended=kind==='launch'&&this.store.repo.tickets.get(effect.value.ticketId)?.ended;this.store.settle(effect,ended?undefined:error)}).finally(()=>this.pending.delete(kind));
   }catch(error){this.record('failure',{effectId:effect.id,error:String(error.message)});this.store.settle(effect,error)}
  }
 }
 cancelCurrent(){this.assessController?.abort();for(const item of this.running.values())item.controller.abort()}
 stop(){this.stopping=true;this.cancelCurrent()}
}
