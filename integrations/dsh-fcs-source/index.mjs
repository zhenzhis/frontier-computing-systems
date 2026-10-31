import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {setTimeout as delay} from 'node:timers/promises';
import {z} from 'zod';
export const name='fcs-source';
export const inject=['orchestrator'];
const schema=z.object({directory:z.string().default(''),pollSeconds:z.number().int().min(2).max(300).default(3)}).strict();
const kind={kind:'fcs',title:{en:'FCS controller',zh:'FCS 迭代控制器'},description:{en:'Receives preauthorized work from the local FCS controller.',zh:'接收本地 FCS 控制器已授权的有限工作。'},schema,
 fields:[{key:'directory',type:'text',label:{en:'Private queue directory',zh:'私有队列目录'}}],health:['fcs'],scope:()=>({listened:true,observed:true}),
 policy:{schema:z.object({allowed:z.array(z.object({id:z.string()})).default([]),bots:z.array(z.object({id:z.string()})).default([])}).strict(),fields:[],explicit:{en:'Local controller requests',zh:'本地控制器请求'}},
 channel:{allowed:()=>true,link:()=>({url:'',label:{en:'Local FCS result',zh:'本地 FCS 结果'}}),send:async()=> 'sent'}};
const write=(file,value)=>{const temp=file+'.tmp';fs.writeFileSync(temp,JSON.stringify(value,null,2));fs.renameSync(temp,file)};
export function apply(ctx){ctx.effect(()=>ctx.orchestrator.sources.register(kind));ctx.effect(()=>{const source=ctx.orchestrator.context(kind),abort=new AbortController();
 const run=async()=>{await source.ready;while(!abort.signal.aborted){const config=source.config('fcs');try{if(config?.directory&&source.configured()){
  fs.mkdirSync(config.directory,{recursive:true});for(const file of fs.readdirSync(config.directory).filter(x=>/^[a-zA-Z0-9-]+\.request\.json$/.test(x))){
   const request=JSON.parse(fs.readFileSync(path.join(config.directory,file),'utf8')),id=request.id;if(!/^[a-zA-Z0-9-]+$/.test(id))throw Error('Invalid FCS request identity');
   await source.receive({id:`fcs-${id}`,source:'fcs',threads:[{source:'fcs',id}],actor:{source:'fcs',id:'controller'},human:false,at:request.at,text:request.prompt,meta:{requestId:id,nativeTicketId:request.nativeTicketId},channel:{source:'fcs',thread:`fcs:${id}`,address:{requestId:id}}});
   const thread=source.threads.get(`fcs:${id}`);if(!thread)continue;for(const ticketId of thread.subscriptions){const ticket=source.tickets.get(ticketId);if(!ticket)continue;
    const receipt=path.join(config.directory,`${id}.receipt.json`);if(!fs.existsSync(receipt))write(receipt,{ticketId});
    if(fs.existsSync(path.join(config.directory,`${id}.cancel`))&&!ticket.ended){await fetch('http://127.0.0.1:3082/orchestrator/api/tickets/'+encodeURIComponent(ticketId)+'/stop',{method:'POST',headers:{'x-orchestrator-request':'1','content-type':'application/json'},body:'{}'});continue}
    const output=path.join(config.directory,`${id}.result.json`);if(fs.existsSync(output))continue;const report=ticket.assignments.at(-1)?.report;
    if(ticket.ended&&report?.state==='ready'){
     const directory=ticket.execution?.directory;if(!directory||!fs.existsSync(directory))throw Error('Completed DSH ticket has no workspace');
     const git=(...args)=>execFileSync('git',args,{cwd:directory,encoding:'utf8'}).trim();git('merge-base','--is-ancestor',request.base,'HEAD');const changed=[...new Set([...git('diff',request.base,'--name-only').split('\n'),...git('ls-files','--others','--exclude-standard').split('\n')].filter(Boolean))];
     const windowsDirectory=process.platform==='linux'?execFileSync('wslpath',['-w',directory],{encoding:'utf8'}).trim():directory;
     write(output,{requestId:id,nativeTicketId:request.nativeTicketId,base:request.base,ticketId,completed:true,directory:windowsDirectory,changed,summary:report.summary,model:'configured exact channel'});
    }else if(['blocked','failed','dropped'].includes(report?.state)||ticket.ended?.by==='human')write(output,{requestId:id,nativeTicketId:request.nativeTicketId,base:request.base,ticketId,completed:false,summary:report?.summary??'Stopped'});
   }
  }source.report('fcs',{state:'ready',detail:'Listening for authorized local controller work'});
 }else source.report('fcs',{state:'paused',detail:'Waiting for a queue configuration'});
 }catch(error){source.report('fcs',{state:'error',detail:String(error.message).slice(0,500)})}await delay((config?.pollSeconds??3)*1000,undefined,{signal:abort.signal}).catch(()=>{})}};
 const running=run();return async()=>{abort.abort();await running}})}
