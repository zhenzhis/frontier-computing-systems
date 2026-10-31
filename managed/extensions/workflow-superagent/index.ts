import type {ExtensionAPI,ExtensionContext} from '@earendil-works/pi-coding-agent';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export default function superagentIntegration(pi:ExtensionAPI){
 const moduleURL=pathToFileURL(path.resolve(import.meta.dirname,'../../../runtime/superagent.mjs')).href;
 const options=()=>process.env.FCS_SUPERAGENT_STATE?{stateRoot:process.env.FCS_SUPERAGENT_STATE}:{};
 const open=async(ctx:ExtensionContext)=>{const {Superagent}=await import(moduleURL);return new Superagent(ctx.cwd,options())};
 pi.registerCommand('workflow-superagent',{description:'Super-agent status/read/ingest/pause/resume/stop；独立服务需显式配置并启动',handler:async(args,ctx)=>{
  try{const i=args.indexOf(' '),action=(i<0?args:args.slice(0,i)).trim()||'status',rest=i<0?'':args.slice(i+1);let result;
   if(action==='status'){const {inspectSuperagent}=await import(moduleURL);result=inspectSuperagent(ctx.cwd,options())}
   else{if(!ctx.isProjectTrusted())throw Error('Project trust required for mutations');const s=await open(ctx);try{
    if(action==='read')result=s.reference(rest);
    else if(action==='ingest')result=s.receive(JSON.parse(rest));
    else if(action==='stop')result=s.engine.stopTicket(rest,'Explicit operator stop');
    else if(action==='pause'||action==='resume'){const c=s.config();result=s.configure({...c,paused:action==='pause'},c.revision)}
    else throw Error('Use status/read/ingest/pause/resume/stop');
   }finally{s.close()}}
   ctx.ui.notify(JSON.stringify(result,null,2),'info');
  }catch(error:any){ctx.ui.notify(String(error.message).replace(/\bsk[-_][\w-]+/g,'[redacted]'),'error')}
 }});
 pi.registerTool({name:'workflow_context',label:'Read linked workflow evidence',description:'Read an existing super-agent evidence reference. No worker is started and no authority is granted.',
  parameters:{type:'object',properties:{reference:{type:'string'}},required:['reference'],additionalProperties:false} as any,
  execute:async(_id,params:any,_signal,_update,ctx)=>{const {superagentDirectory}=await import(moduleURL);const fs=await import('node:fs');if(!fs.existsSync(path.join(superagentDirectory(ctx.cwd,options().stateRoot),'superagent.sqlite')))return{content:[{type:'text',text:'No super-agent record exists for this project.'}],details:{}};
   const s=await open(ctx);try{return{content:[{type:'text',text:JSON.stringify(s.reference(params.reference))}],details:{}}}finally{s.close()}}
 });
}
