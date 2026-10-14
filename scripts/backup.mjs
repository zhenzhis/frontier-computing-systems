import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {audit} from './audit-public.mjs';

export function backup(root,destination,{apply=false}={}){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 if(!destination)throw Error('An explicit private backup destination is required');
 if(git('status','--porcelain'))throw Error('Commit or preserve dirty work before a versioned source backup');
 const checked=audit(root,{history:true});if(!checked.passed)throw Error('Public-source history audit failed');
 const commits=git('rev-list','--reverse','--all').split('\n').filter(Boolean);
 const folder=path.resolve(destination,'public-source',new Date().toISOString().replaceAll(':','-'));
 if(folder.toLowerCase().startsWith((path.resolve(root)+path.sep).toLowerCase()))throw Error('Backup destination must be outside the project');
 const result={apply,folder,commits:commits.length,head:git('rev-parse','HEAD'),scope:'Public source history and every commit; no live credentials or session backup',artifacts:[]};
 if(!apply)return result;
 fs.mkdirSync(folder,{recursive:true});
 const bundle=path.join(folder,'history.bundle');git('bundle','create',bundle,'--all');git('bundle','verify',bundle);
 const rows=[];
 for(const commit of commits){const name=`version-${commit.slice(0,12)}.zip`,target=path.join(folder,name);git('archive','--format=zip',`--output=${target}`,commit);rows.push({file:name,commit,tags:git('tag','--points-at',commit).split('\n').filter(Boolean)});}
 for(const name of ['history.bundle',...rows.map(x=>x.file)]){const bytes=fs.readFileSync(path.join(folder,name));result.artifacts.push({file:name,bytes:bytes.length,sha256:crypto.createHash('sha256').update(bytes).digest('hex')});}
 result.versions=rows;result.bundleVerified=true;
 fs.writeFileSync(path.join(folder,'catalog.json'),JSON.stringify(result,null,2)+'\n');return result;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),args=process.argv.slice(2),i=args.indexOf('--destination');
 try{console.log(JSON.stringify(backup(root,i>=0?args[i+1]:null,{apply:args.includes('--apply')}),null,2));}catch(e){console.error(e.message);process.exitCode=1;}
}
