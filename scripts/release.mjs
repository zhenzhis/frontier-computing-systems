import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {backup} from './backup.mjs';

const defaultRoot=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
// The release gate exists to execute what `npm test` executes. It understands
// exactly one shape of test script; any other shape is refused rather than
// running a narrower suite than the package declares.
const testDirectories=['runtime','tests'],testGlob=/^([A-Za-z0-9._-]+)\/\*\.test\.mjs$/;

export function releaseTestFiles(root=defaultRoot){
 const file=path.join(root,'package.json');
 if(!fs.existsSync(file))throw Error(`Release test set needs ${file}`);
 const script=JSON.parse(fs.readFileSync(file,'utf8')).scripts?.test;
 if(typeof script!=='string'||!script.trim())throw Error('package.json declares no scripts.test; refusing to guess the release test set');
 const tokens=script.trim().split(/\s+/);
 if(tokens[0]!=='node'||tokens[1]!=='--test'||tokens.length!==2+testDirectories.length)throw Error(`Unrecognised test script: ${script}`);
 const declared=[],files=[];
 for(const pattern of tokens.slice(2)){
  const match=testGlob.exec(pattern);
  if(!match||!testDirectories.includes(match[1]))throw Error(`Unrecognised test pattern in scripts.test: ${pattern}`);
  if(declared.includes(match[1]))throw Error(`Test directory declared twice in scripts.test: ${match[1]}`);
  declared.push(match[1]);
  const directory=path.join(root,match[1]);
  if(!fs.existsSync(directory)||!fs.statSync(directory).isDirectory())throw Error(`Test pattern does not name a release directory: ${pattern}`);
  const found=fs.readdirSync(directory,{withFileTypes:true}).filter(entry=>entry.isFile()&&entry.name.endsWith('.test.mjs')).map(entry=>`${match[1]}/${entry.name}`);
  if(!found.length)throw Error(`Test pattern matches no test file: ${pattern}`);
  files.push(...found);
 }
 const undeclared=testDirectories.filter(directory=>!declared.includes(directory));
 if(undeclared.length)throw Error(`scripts.test does not cover the release test directories: ${undeclared.join(', ')}`);
 return [...new Set(files)].sort();
}

export function releasePlan(root=defaultRoot,{apply=false,push=false,backupDestination=null}={}){
 const version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 if(!/^\d+\.\d+\.\d+$/.test(version))throw Error('Release requires an explicit semver');
 return {tag:`v${version}`,backupDestination,apply,push,requiresSuccessfulRemoteCIForPush:true,steps:['verify clean committed candidate','verify public source and native SDK','check already-pushed candidate CI before public tag push','backup all versions','create immutable annotated tag','backup tagged refs','push tag only when explicitly selected']};
}

export function release(root=defaultRoot,{apply=false,push=false,backupDestination=null}={}){
 const git=(...args)=>execFileSync('git',args,{cwd:root,encoding:'utf8'}).trim();
 const plan=releasePlan(root,{apply,push,backupDestination});
 if(!apply)return plan;
 const version=plan.tag.slice(1);
 if(!backupDestination)throw Error('--backup-dir is required');
 if(git('status','--porcelain'))throw Error('Release candidate is dirty');
 if(git('tag','--list',plan.tag))throw Error('Release tag already exists; never overwrite');
 if(push){
  const head=git('rev-parse','HEAD'),remote=git('ls-remote','origin','refs/heads/main').split(/\s+/)[0];
  if(remote!==head)throw Error('Push the candidate to main, back it up and wait for its CI before publishing the tag');
  const runs=JSON.parse(execFileSync('gh',['run','list','--workflow','verify.yml','--commit',head,'--limit','1','--json','headSha,status,conclusion'],{cwd:root,encoding:'utf8'}));
  if(!runs.some(run=>run.headSha===head&&run.status==='completed'&&run.conclusion==='success'))throw Error('Latest remote Verify run for this exact candidate must pass before tag publication');
 }
 for(const script of ['scripts/audit-public.mjs','scripts/verify-links.mjs','scripts/verify-manifest.mjs','scripts/verify-sdk.mjs'])execFileSync(process.execPath,[script],{cwd:root,stdio:'inherit'});
 execFileSync(process.execPath,['--test',...releaseTestFiles(root)],{cwd:root,stdio:'inherit'});
 const before=backup(root,backupDestination,{apply:true});
 git('tag','-a',plan.tag,'-m',`Frontier Computing Systems ${version}`);
 const after=backup(root,backupDestination,{apply:true});
 if(push)git('push','origin',plan.tag);
 return {...plan,before:before.folder,after:after.folder,completed:true};
}

export function releaseArgs(args=[]){const i=args.indexOf('--backup-dir');return{apply:args.includes('--apply'),push:args.includes('--push'),backupDestination:i>=0?args[i+1]??null:null};}

if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{console.log(JSON.stringify(release(defaultRoot,releaseArgs(process.argv.slice(2))),null,2));}
 catch(error){console.error(error.message);process.exitCode=1;}
}
