import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..'),failures=[];
let documents=0;
function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','.git','.private','.local'].includes(item.name))continue;
 const file=path.join(dir,item.name);if(item.isDirectory()){walk(file);continue;}if(!item.name.endsWith('.md'))continue;
 documents++;const source=fs.readFileSync(file,'utf8').replace(/^```[^\n]*\n[\s\S]*?^```\s*$/gm,'');
 for(const [,link] of source.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)){
  if(/^(?:https?:|mailto:|#)/.test(link))continue;
  const target=path.resolve(path.dirname(file),decodeURIComponent(link.split('#')[0]));
  if(!fs.existsSync(target))failures.push({file:path.relative(root,file),link});
 }
}}
walk(root);console.log(JSON.stringify({passed:!failures.length,documents,failures},null,2));if(failures.length)process.exitCode=1;
