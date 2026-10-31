import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {projectPath} from './control.mjs';

/** Handoff between the native controller and the independently deployed official DSH service. */
export async function runDshWorker({queue,allowedWorkspaceRoot,nativeTicketId,project,base,sourceRepository,plan,prompt,signal,onProgress=()=>{}}){
 const id=crypto.randomUUID(),file=path.join(queue,`${id}.request.json`);fs.mkdirSync(queue,{recursive:true});
 const request={id,at:new Date().toISOString(),nativeTicketId,base,sourceRepository,files:plan.files,prompt:`This is a preauthorized FCS controller assignment. Work only on the FCS source checkout prepared for this ticket. Exact assigned files: ${JSON.stringify(plan.files)}. Do not push, create PRs, merge, publish, edit credentials, change permission settings, or change the controller. The external controller performs validation and automatic publication. Task: ${JSON.stringify(plan)}. Controller notes (native tool names in these notes are not DSH tools): ${prompt}. Use your DSH file and shell tools for local implementation, and orchestrator_report with state ready for the final report. Carry the local work to a ready result without a pull request.`,plan};
 fs.writeFileSync(file,JSON.stringify(request,null,2),{flag:'wx'});
 const abort=()=>fs.writeFileSync(path.join(queue,`${id}.cancel`),'Explicit cancellation');signal?.addEventListener('abort',abort,{once:true});
 try{for(;;){if(signal?.aborted)throw Error('DSH assignment cancelled');const output=path.join(queue,`${id}.result.json`);if(fs.existsSync(output)){
   const result=JSON.parse(fs.readFileSync(output,'utf8'));if(result.requestId!==id||result.nativeTicketId!==nativeTicketId||result.base!==base)throw Error('DSH result does not match the immutable assignment');if(result.completed!==true)throw Error(`DSH worker did not complete: ${result.summary}`);
   const source=fs.realpathSync(result.directory),root=fs.realpathSync(allowedWorkspaceRoot);if(!source.toLowerCase().startsWith(root.toLowerCase()+path.sep))throw Error('DSH workspace is outside the configured execution root');
   const assignment=JSON.parse(fs.readFileSync(path.join(source,'.local','fcs-assignment.json'),'utf8'));if(assignment.requestId!==id||assignment.base!==base||assignment.nativeTicketId!==nativeTicketId)throw Error('DSH workspace belongs to another assignment');
   if(!Array.isArray(result.changed)||result.changed.some(f=>f!=='release-manifest.json'&&!plan.files.includes(f)))throw Error('DSH worker changed unassigned files');
   // The supervisor regenerates the release manifest from actual source; never adopt a worker's hashes.
   for(const relative of result.changed.filter(f=>f!=='release-manifest.json')){const from=projectPath(source,relative),to=projectPath(fs.realpathSync(project),relative);if(fs.existsSync(from)){fs.mkdirSync(path.dirname(to),{recursive:true});fs.copyFileSync(from,to)}else if(fs.existsSync(to))fs.unlinkSync(to)}
   const archive=path.join(queue,'archive',id);fs.mkdirSync(archive,{recursive:true});for(const entry of fs.readdirSync(queue).filter(f=>f.startsWith(id+'.')))fs.renameSync(path.join(queue,entry),path.join(archive,entry));
   return{summary:result.summary,completed:true,executor:'dsh',dshTicketId:result.ticketId,requestId:id,base};
  }onProgress({executor:'dsh',requestId:id});await new Promise(r=>setTimeout(r,2000))}
 }finally{signal?.removeEventListener('abort',abort)}
}
