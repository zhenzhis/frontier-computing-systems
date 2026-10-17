import fs from 'node:fs';
import { ProjectStore, VERSION } from './control.mjs';
const args=process.argv.slice(2);
const read=()=>JSON.parse(fs.readFileSync(0,'utf8'));
const project=args.shift(); const command=args.shift()??'status';
try {
  if(!project)throw Error('Usage: node runtime/cli.mjs <project> <command> [task-id] [revision]; structured mutations read JSON from stdin');
  const store=new ProjectStore(project);let result;
  const [id,rev]=args; const revision=Number(rev);
  switch(command){
    case 'status':result={version:VERSION,project:store.project,tasks:store.list(),stateRoot:store.root};break;
    case 'create':result=store.create(read());break;
    case 'show':result=store.snapshot(id);break;
    case 'checkpoint':result=store.update(id,revision,read());break;
    case 'arm':result=store.arm(id,revision);break;
    case 'pause':result=store.pause(id,revision);break;
    case 'recover':result=store.recover(id,revision);break;
    case 'unlock-dead':result=store.unlockDead(Number(id));break;
    case 'evidence':result=store.evidence(id,revision,read());break;
    case 'complete':result=store.complete(id,revision);break;
    case 'effect-intent':{const input=read();result=store.effectIntent(id,revision,input.actionId,input.description);break;}
    case 'effect-resolve':{const input=read();result=store.resolveEffect(id,revision,input.actionId,input.observation);break;}
    case 'inbox':result=store.read().events;break;
    case 'ingest':result=store.ingest(read());break;
    case 'triage':result=store.triage(id,read());break;
    case 'lessons':result=store.read().lessons;break;
    case 'lesson':result=store.lesson(read());break;
    case 'lesson-review':result=store.promoteLesson(id,read());break;
    case 'lesson-amend':result=store.amendLesson(id,revision,read());break;
    case 'experiments':result=store.read().experiments;break;
    case 'experiment':result=store.proposeExperiment(read());break;
    case 'experiment-result':result=store.experimentResult(id,read());break;
    case 'experiment-review':result=store.reviewExperiment(id,read());break;
    case 'evaluation-summary':result=store.evaluationSummary(id);break;
    default:throw Error('Unknown command');
  }
  console.log(JSON.stringify(result,null,2));
}catch(error){console.error(String(error.message).replace(/\bsk[-_][\w-]+/g,'[redacted]'));process.exitCode=1;}
