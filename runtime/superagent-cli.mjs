import fs from 'node:fs';
import {Superagent,inspectSuperagent} from './superagent.mjs';
const [project,command='status',argument]=process.argv.slice(2);
try{
 if(!project)throw Error('Usage: superagent-cli <project> status|configure|ingest|read|stop|pause|resume [reference or ticket]. Mutations read JSON from stdin.');
 const options=process.env.FCS_SUPERAGENT_STATE?{stateRoot:process.env.FCS_SUPERAGENT_STATE}:{};
 if(command==='status')console.log(JSON.stringify(inspectSuperagent(project,options),null,2));
 else{const s=new Superagent(project,options);try{let result;const read=()=>JSON.parse(fs.readFileSync(0,'utf8'));
  switch(command){case'configure':{const data=read();result=s.configure(data.value,data.revision);break}case'ingest':result=s.receive(read());break;case'read':result=s.reference(argument);break;case'stop':result=s.engine.stopTicket(argument,'Explicit operator stop');break;case'pause':case'resume':{const c=s.config();result=s.configure({...c,paused:command==='pause'},c.revision);break}default:throw Error('Unknown superagent command')}
  console.log(JSON.stringify(result,null,2));}finally{s.close()}}
}catch(error){console.error(String(error.message).replace(/\bsk[-_][\w-]+/g,'[redacted]'));process.exitCode=1}
