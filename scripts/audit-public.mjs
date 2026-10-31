import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

export const rules=[
 ['provider-key',/\bsk[-_][A-Za-z0-9_-]{16,}/],
 ['github-token',/\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/],
 ['github-fine-grained',/\bgithub_pat_[A-Za-z0-9_]{20,}/],
 ['private-key',/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
 ['oauth-value',/"(?:access_token|refresh_token)"\s*:\s*"(?!<|REDACTED|EXAMPLE)[A-Za-z0-9_./+-]{16,}"/i],
 ['personal-home',/[A-Z]:[\\/]Users[\\/](?!<|\*|user[\\/]|example[\\/])[a-z0-9_-]+[\\/]/i],
];
const forbidden=/(?:^|\/)(?:auth|mcp-auth|models|models-store|settings|trust)\.json$|(?:^|\/)(?:sessions|state|backups|\.private|\.local)\//i;
export function inspect(name,text){return [...(forbidden.test(name)?['private-file']:[]),...rules.filter(([,pattern])=>pattern.test(text)).map(([name])=>name)];}
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
export function audit(rootDir=root,{history=false}={}){
 const failures=[],files=[];
 const walk=dir=>{for(const item of fs.readdirSync(dir,{withFileTypes:true})){if(['.git','node_modules','.local','.private'].includes(item.name))continue;const p=path.join(dir,item.name);if(item.isSymbolicLink()){failures.push({file:path.relative(rootDir,p),rules:['symlink']});continue;}if(item.isDirectory())walk(p);else files.push(p);}};
 walk(rootDir);
 for(const file of files){const name=path.relative(rootDir,file).replaceAll('\\','/');if(name==='validation.local.json')continue;const issues=inspect(name,fs.readFileSync(file,'utf8'));if(issues.length)failures.push({file:name,rules:issues});}
 let commits=0;
 if(history){
  const refs=execFileSync('git',['rev-list','--all'],{cwd:rootDir,encoding:'utf8'}).trim().split('\n').filter(Boolean);
  for(const commit of refs){commits++;const names=execFileSync('git',['ls-tree','-r','--name-only','-z',commit],{cwd:rootDir,encoding:'utf8'}).split('\0').filter(Boolean);for(const name of names){const text=execFileSync('git',['show',`${commit}:${name}`],{cwd:rootDir,encoding:'utf8',maxBuffer:16*1024*1024});const issues=inspect(name,text);if(issues.length)failures.push({file:name,commit:commit.slice(0,12),rules:issues});}}
 }
 return {passed:failures.length===0,files:files.length,commits,failures,note:'Pattern scan reports locations only; it is not proof that every secret or personal detail is detectable.'};
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const rootIndex=process.argv.indexOf('--root');const report=audit(rootIndex>=0?fs.realpathSync(process.argv[rootIndex+1]):root,{history:process.argv.includes('--history')});console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;
}
