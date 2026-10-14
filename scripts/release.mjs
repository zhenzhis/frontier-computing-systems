import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {backup} from './backup.mjs';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,tag=`v${version}`;
const args=process.argv.slice(2),i=args.indexOf('--backup-dir'),destination=i>=0?args[i+1]:null;
const git=(...a)=>execFileSync('git',a,{cwd:root,encoding:'utf8'}).trim();
try{
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Release requires an explicit semver');
 const plan={tag,backupDestination:destination,apply:args.includes('--apply'),push:args.includes('--push'),steps:['verify clean committed candidate','verify public source and native SDK','backup all versions','create immutable annotated tag','backup tagged refs','push only when explicitly selected']};
 if(!plan.apply){console.log(JSON.stringify(plan,null,2));}
 else{
  if(!destination)throw Error('--backup-dir is required');
  if(git('status','--porcelain'))throw Error('Release candidate is dirty');
  if(git('tag','--list',tag))throw Error('Release tag already exists; never overwrite');
  for(const script of ['scripts/audit-public.mjs','scripts/verify-manifest.mjs','scripts/verify-sdk.mjs'])execFileSync(process.execPath,[script],{cwd:root,stdio:'inherit'});
  const tests=['runtime/control.test.mjs','runtime/feedback.test.mjs',...fs.readdirSync(path.join(root,'tests')).filter(x=>x.endsWith('.test.mjs')).map(x=>'tests/'+x)];
  execFileSync(process.execPath,['--test',...tests],{cwd:root,stdio:'inherit'});
  const before=backup(root,destination,{apply:true});
  git('tag','-a',tag,'-m',`ZhenZhi Workflow ${version}`);
  const after=backup(root,destination,{apply:true});
  if(plan.push){git('push','origin','HEAD');git('push','origin',tag);}
  console.log(JSON.stringify({...plan,before:before.folder,after:after.folder,completed:true},null,2));
 }
}catch(e){console.error(e.message);process.exitCode=1;}
