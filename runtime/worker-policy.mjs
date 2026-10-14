import path from 'node:path';
import {projectPath} from './control.mjs';
export function workerPolicy(project,task) {
  const allowed=new Set(task.stage==='implement'&&task.authority.actions.includes('write')?['read','grep','find','ls','edit','write']:['read','grep','find','ls']);
  const guard=event=>{
    if(!allowed.has(event.toolName))return {block:true,reason:'WF7 worker permits scoped file tools only; checks and external effects belong to the controller'};
    const input=event.input??{},target=input.path??input.file_path??'.';
    try {
      const relative=path.isAbsolute(target)?path.relative(project,target):target;
      projectPath(project,relative);
      if(['edit','write'].includes(event.toolName)&&!Object.keys(task.baseline).some(f=>path.resolve(project,f).toLowerCase()===path.resolve(project,relative).toLowerCase()))return {block:true,reason:'Worker write outside exact assigned files refused'};
    }catch{return {block:true,reason:'Worker file access outside assigned project refused'};}
  };
  return {allowed,guard,factory:pi=>pi.on('tool_call',guard)};
}
