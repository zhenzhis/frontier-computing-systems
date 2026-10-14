import {getAgentDir,SettingsManager,type ExtensionAPI,type ExtensionContext} from '@earendil-works/pi-coding-agent';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';

const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../../..');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
export default function workflowBaseline(pi:ExtensionAPI){
 let warned=false;
 const budget=(ctx:ExtensionContext)=>{
  const settings=SettingsManager.create(ctx.cwd,getAgentDir(),{projectTrusted:ctx.isProjectTrusted()});
  const effective=settings.getCompactionSettings(ctx.model),usage=ctx.getContextUsage();
  const window=usage?.contextWindow??ctx.model?.contextWindow;
  const trigger=window?window-effective.reserveTokens:undefined;
  return {effective,usage,window,trigger,attention:trigger?Math.min(192000,trigger):192000};
 };
 const update=(ctx:ExtensionContext,notify=false)=>{
  const b=budget(ctx),over=b.usage?.tokens!=null&&b.usage.tokens>=b.attention;
  if(!over)warned=false;
  ctx.ui.setStatus('workflow-baseline',`ZhenZhi v${version} | 整理提醒 ${Math.round(b.attention/1000)}K${over?' · 已达到':''}`);
  if(notify&&over&&!warned){warned=true;ctx.ui.notify('复杂任务先保存实际证据，再按阶段整理上下文。提醒不触发自动压缩。','warning');}
  return b;
 };
 for(const event of ['session_start','session_switch','model_select','session_compact'] as const)pi.on(event,(_event,ctx)=>{warned=false;update(ctx);});
 for(const event of ['agent_end','turn_end'] as const)pi.on(event,(_event,ctx)=>{update(ctx,true);});
 pi.registerCommand('workflow-status',{description:'Read workflow version, context budget and package integrity',handler:async(args,ctx)=>{
  const b=update(ctx),manifest=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));
  const drift=manifest.files.filter((entry:{path:string;sha256:string})=>{
   const file=path.join(root,entry.path);return !fs.existsSync(file)||crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')!==entry.sha256;
  }).map((entry:{path:string})=>entry.path);
  const status={workflow:`zhenzhi-workflow-v${version}`,model:ctx.model?`${ctx.model.provider}/${ctx.model.id}`:null,declaredContextWindow:b.window,contextTokens:b.usage?.tokens,attentionReminderTokens:b.attention,nativeCompaction:b.effective,nativeTriggerAboveTokens:b.trigger,automaticEarlyCompaction:false,intentRouting:'deferred',integrity:{passed:drift.length===0,drift},note:'Channel metadata is not measured quality; this command makes no model request.'};
  ctx.ui.notify(args.trim()==='--json'?JSON.stringify(status,null,2):`ZhenZhi Workflow v${version}\n模型：${status.model??'未选择'}\n容量：${b.window??'未知'}；整理提醒：${b.attention}\n原生压缩：${b.effective.enabled?'启用':'关闭'}\n包完整性：${drift.length?'存在漂移':'通过'}\n意图分流：暂缓采用`,'info');
 }});
}
