import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { ProjectStore,hash } from './control.mjs';
import {workerPolicy} from './worker-policy.mjs';

// Explicit, one-shot, foreground worker. Run detached only after preparing a task,
// arming its exact revision and choosing --execute. No persistent service is installed.
const [project,id,revision,flag]=process.argv.slice(2);
if(!project||!id){console.error('Usage: node runtime/worker.mjs <project> <task-id> <revision> [--execute]; defaults to inspection');process.exit(1);}
const store=new ProjectStore(project);
if(flag!=='--execute'){console.log(JSON.stringify({...store.snapshot(id),willExecute:false},null,2));process.exit(0);}
const sdk=await import('@earendil-works/pi-coding-agent');
const agentDir=process.env.PI_CODING_AGENT_DIR||sdk.getAgentDir();
const settings=JSON.parse(fs.readFileSync(path.join(agentDir,'settings.json'),'utf8'));
const task=store.claim(id,Number(revision)); const token=task.worker.token,start=Date.now();
let session, runtime, used=0,timer,poll,extensionFailure=false;
try{
  // Never copy credentials into pilot state. SDK uses the existing authorized channel.
  runtime=await sdk.ModelRuntime.create({allowModelNetwork:true});
  const manager=sdk.SettingsManager.inMemory(settings);
  const {allowed,factory:workerGuard}=workerPolicy(store.project,task);
  const loader=new sdk.DefaultResourceLoader({cwd:store.project,agentDir,settingsManager:manager,extensionFactories:[workerGuard]});await loader.reload();
  const created=await sdk.createAgentSession({cwd:store.project,resourceLoader:loader,modelRuntime:runtime,settingsManager:manager,sessionManager:sdk.SessionManager.create(store.project,path.join(store.root,'sessions'))});
  session=created.session;
  if(created.extensionsResult.errors.length)throw Error('Extension loading failed; worker refused');
  await session.bindExtensions({mode:'rpc',onError:()=>{extensionFailure=true;void session.abort();}});
  // Research/review cannot write even if a prompt asks. External actions still rely on
  // the existing permission pipeline; no interactive approval is available in RPC.
  session.setActiveToolsByName(session.getActiveToolNames().filter(n=>allowed.has(n)));
  const remainingMs=task.budget.maxWallMinutes*60000-task.spent.wallMs;
  timer=setTimeout(()=>{void session.abort();},remainingMs);
  let stopped=false;
  session.subscribe(event=>{
    if(event.type==='message_end'&&event.message?.role==='assistant'){
      const u=event.message.usage??{};used+=(u.input??0)+(u.output??0)+(u.cacheRead??0)+(u.cacheWrite??0);
      if(used+task.spent.tokens>=task.budget.maxTokens){stopped=true;void session.abort();}
    }
  });
  poll=setInterval(()=>{try{const t=store.get(id);if(t.cancelRequested||t.worker?.token!==token)void session.abort();}catch{void session.abort();}},1000);
  const prompt=[task.goal,`授权阶段：${task.stage}；范围：${task.scope}`,`验收：${JSON.stringify(task.acceptance)}`,
    '这是一次有限任务执行。沿用项目与权限规则；不发送消息、不发布、不改权限/凭据、不启动额外 Goal。记录真实未验证项，最终回答不代表任务已经独立验收。',
    `恢复线索：${task.checkpoint}\n下一步：${task.nextAction}`].join('\n');
  await session.prompt(prompt);
  if(extensionFailure)throw Error('Extension runtime error; worker aborted, inspect local session before retry');
  const outcome=stopped||Date.now()-start>=remainingMs?'waiting':'verifying';
  store.settle(id,token,{tokens:used,wallMs:Date.now()-start,outcome});
  console.log(JSON.stringify({task:id,outcome,tokens:used,wallMs:Date.now()-start,independentAcceptance:false,tokenLimit:'checked at response boundaries; one response can exceed remaining budget'}));
}catch(e){
  try{store.settle(id,token,{tokens:used,wallMs:Date.now()-start,outcome:'failed',failureFingerprint:hash(String(e.message))});}catch(settleError){console.error('Settlement failed; preserve ledger and inspect worker state: '+String(settleError.message).replace(/\bsk[-_][\w-]+/g,'[redacted]'));}
  console.error(String(e.message).replace(/\bsk[-_][\w-]+/g,'[redacted]'));process.exitCode=1;
}finally{clearTimeout(timer);clearInterval(poll);await session?.dispose();await runtime?.close();}
