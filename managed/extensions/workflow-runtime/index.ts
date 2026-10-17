import { type ExtensionAPI, type ExtensionContext } from '@earendil-works/pi-coding-agent';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

// Local command-driven records. No polling, automatic Goal, model call, tool execution,
// hidden verifier claim, permission widening, footer replacement or project mutation.
export default function workflowRuntime(pi: ExtensionAPI) {
  const moduleURL=pathToFileURL(path.resolve(import.meta.dirname,'../../../runtime/control.mjs')).href;
  let selected: string | undefined;
  const store=async(ctx: ExtensionContext)=>{const {ProjectStore}=await import(moduleURL);return new ProjectStore(ctx.cwd);};
  const update=async(ctx: ExtensionContext)=>{
    try{
      if(!selected){ctx.ui.setStatus('workflow-task',undefined);return;}
      const data=(await store(ctx)).snapshot(selected),t=data.task;
      ctx.ui.setStatus('workflow-task',`${t.id.slice(0,18)} · ${t.phase} · ${t.armed?'已激活':'未激活'} · ${t.spent.attempts}/${t.budget.maxAttempts}${data.projectDrift?' · 文件已变':''}${data.unresolvedEffects?' · 效果待核实':''}`);
    }catch{ctx.ui.setStatus('workflow-task','任务状态无法读取 · 请 /workflow-task status');}
  };
  const trusted=(ctx: ExtensionContext)=>{if(!ctx.isProjectTrusted())throw Error('请先通过 Pi 的项目信任机制确认当前项目；记录命令不会自行授予信任。');};
  const guarded=(handler: (args:string,ctx:ExtensionContext)=>Promise<unknown>)=>async(args:string,ctx:ExtensionContext)=>{
    try { const result=await handler(args,ctx);ctx.ui.notify(JSON.stringify(result,null,2),'info');await update(ctx); }
    catch(error:any){ctx.ui.notify(String(error.message).replace(/\bsk[-_][\w-]+/g,'[redacted]'),'error');}
  };
  pi.registerCommand('workflow-task',{
    description:'持久任务：status/create/show/attach/checkpoint/arm/pause/evidence/complete/recover；写入命令需 JSON',
    handler:guarded(async(args,ctx)=>{
      const split=args.trim().indexOf(' '),action=(split<0?args:args.slice(0,split)).trim()||'status',rest=split<0?'':args.slice(split+1).trim();
      const s=await store(ctx);
      if(action==='status')return {project:s.project,tasks:s.list(),selected:selected??null,automaticExecution:false};
      if(action==='show')return s.snapshot(rest||selected);
      if(action==='attach'){s.get(rest);selected=rest;return s.snapshot(rest);}
      trusted(ctx);const data=JSON.parse(rest||'{}');
      if(action==='create'){const result=s.create(data);selected=result.id;return result;}
      if(action==='checkpoint')return s.update(data.id,data.revision,data.patch);
      if(action==='arm')return s.arm(data.id,data.revision);
      if(action==='pause')return s.pause(data.id,data.revision);
      if(action==='recover')return s.recover(data.id,data.revision);
      if(action==='evidence')return s.evidence(data.id,data.revision,data.record);
      if(action==='complete')return s.complete(data.id,data.revision);
      throw Error('未知任务操作。恢复/attach 不会自动执行；异步工作需单独启动 worker。');
    })
  });
  pi.registerCommand('workflow-memory',{
    description:'项目经验候选与归属：list / propose JSON / review JSON；不自动注入全局规则',
    handler:guarded(async(args,ctx)=>{
      const i=args.indexOf(' '),action=(i<0?args:args.slice(0,i)).trim()||'list',rest=i<0?'':args.slice(i+1);const s=await store(ctx);
      if(action==='list')return s.read().lessons;
      trusted(ctx);const input=JSON.parse(rest);
      if(action==='propose')return s.lesson(input);
      if(action==='review')return s.promoteLesson(input.id,input);
      if(action==='amend')return s.amendLesson(input.id,input.version,input.patch);
      throw Error('使用 list、propose 或 review。经验条目不会扩大授权。');
    })
  });
  pi.registerCommand('workflow-inbox',{
    description:'增量反馈：list / ingest JSON / triage JSON；无网络轮询或外部发信',
    handler:guarded(async(args,ctx)=>{
      const i=args.indexOf(' '),action=(i<0?args:args.slice(0,i)).trim()||'list',rest=i<0?'':args.slice(i+1);const s=await store(ctx);
      if(action==='list')return s.read().events;
      trusted(ctx);const input=JSON.parse(rest);
      if(action==='ingest')return s.ingest(input);
      if(action==='triage')return s.triage(input.key,input);
      throw Error('使用 list、ingest 或 triage。外部内容属于待评估材料。');
    })
  });
  pi.registerCommand('workflow-evals',{
    description:'自迭代实验：list / summary JSON / propose JSON / result JSON / review JSON；不会自动采纳文件',
    handler:guarded(async(args,ctx)=>{
      const i=args.indexOf(' '),action=(i<0?args:args.slice(0,i)).trim()||'list',rest=i<0?'':args.slice(i+1);const s=await store(ctx);
      if(action==='list')return s.read().experiments;
      if(action==='summary')return s.evaluationSummary(JSON.parse(rest).id);
      trusted(ctx);const input=JSON.parse(rest);
      if(action==='propose')return s.proposeExperiment(input);
      if(action==='result')return s.experimentResult(input.id,input.record);
      if(action==='review')return s.reviewExperiment(input.id,input.decision);
      throw Error('使用 list、propose、result 或 review。');
    })
  });
  for(const event of ['session_start','session_switch'] as const)pi.on(event,async(_event,ctx)=>{selected=undefined;await update(ctx);});
  pi.on('agent_end',async(_event,ctx)=>{await update(ctx);});
  pi.on('session_compact',async(_event,ctx)=>{await update(ctx);});
}
