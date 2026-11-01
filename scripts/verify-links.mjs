import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const rootIndex=process.argv.indexOf('--root');
const root=rootIndex>=0?fs.realpathSync(process.argv[rootIndex+1]):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const failures=[];
let documents=0;

// A fence may sit at the line start, be indented by up to three spaces (for example
// inside a list item) or live inside one or more blockquotes. Markdown code fences
// and quoted examples are documentation, not links.
const container=/^(?: {0,3}>[ \t]?)* {0,3}/;

function withoutFences(source){
 let fence=null;
 return source.split('\n').map(line=>{
  const body=line.replace(container,'');
  if(fence){
   const close=/^(`{3,})\s*$/.exec(body);
   if(close&&close[1].length>=fence.length)fence=null;
   return '';
  }
  const open=/^(`{3,})([^`]*)$/.exec(body);
  if(open){fence=open[1];return '';}
  return line;
 }).join('\n');
}

// Inline code spans are examples too. Mask them without removing newlines so the
// remaining text keeps its document shape for the link scan.
function withoutInlineCode(source){
 return source.replace(/(?<!`)(`+)(?!`)([\s\S]*?)(?<!`)\1(?!`)/g,match=>match.replace(/[^\n]/g,' '));
}

function scan(file,source){
 for(const [,link] of source.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)){
  if(/^(?:https?:|mailto:|#)/.test(link))continue;
  const raw=link.split('#')[0];
  let target;
  try{
   target=path.resolve(path.dirname(file),decodeURIComponent(raw));
  }catch{
   // A malformed percent escape must remain a report field, never an uncaught URIError.
   failures.push({file:path.relative(root,file),link,reason:'undecodable-link'});
   continue;
  }
  if(!fs.existsSync(target))failures.push({file:path.relative(root,file),link});
 }
}

function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','.git','.private','.local'].includes(item.name))continue;
 const file=path.join(dir,item.name);if(item.isDirectory()){walk(file);continue;}if(!item.name.endsWith('.md'))continue;
 documents++;const source=fs.readFileSync(file,'utf8');
 scan(file,withoutInlineCode(withoutFences(source)));
}}
walk(root);console.log(JSON.stringify({passed:!failures.length,documents,failures},null,2));if(failures.length)process.exitCode=1;