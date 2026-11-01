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

// GitHub derives a heading anchor from its rendered text: lower case, whitespace
// as hyphens, punctuation and emphasis markers dropped, while inline code, link
// labels and CJK characters keep their text. Repeated headings get -1, -2, ...
function slugify(text){
 return text
  .toLowerCase()
  .replace(/!\[([^\]]*)\]\([^)]*\)/g,'$1')
  .replace(/\[([^\]]*)\]\([^)]*\)/g,'$1')
  .replace(/<[^>]*>/g,'')
  .replace(/`+([^`]*)`+/g,'$1')
  .replace(/[*_~]/g,'')
  .replace(/[^\p{L}\p{N}\p{M}\s_-]/gu,'')
  .trim()
  .replace(/\s+/g,'-');
}

// Headings outside fences provide implicit anchors; explicit id="..." attributes
// and <a name="..."> elements provide additional anchors anywhere in the document.
function collectAnchors(source){
 const body=withoutFences(source),anchors=new Set(),seen=new Map();
 for(const line of body.split('\n')){
  const heading=/^(?: {0,3}>[ \t]?)* {0,3}#{1,6}(?:[ \t]+(.*?))?[ \t]*$/.exec(line);
  if(!heading)continue;
  const base=slugify((heading[1]??'').replace(/[ \t]+#+[ \t]*$/,''));
  if(!base)continue;
  let suffix=seen.get(base)??0,slug=base;
  while(anchors.has(slug)){suffix++;slug=`${base}-${suffix}`;}
  seen.set(base,suffix);
  anchors.add(slug);
 }
 const markup=withoutInlineCode(body);
 for(const match of markup.matchAll(/<[a-z][^>]*\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)){
  const value=match[1]??match[2]??match[3];
  if(value)anchors.add(value);
 }
 for(const match of markup.matchAll(/<a\b[^>]*\bname\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/gi)){
  const value=match[1]??match[2]??match[3];
  if(value)anchors.add(value);
 }
 return anchors;
}

const anchorCache=new Map();
const documentAnchors=file=>{
 if(!anchorCache.has(file))anchorCache.set(file,collectAnchors(fs.readFileSync(file,'utf8')));
 return anchorCache.get(file);
};

// Fragments may be written literally or percent-encoded; both name the same anchor.
const hasAnchor=(file,fragment)=>{
 const anchors=documentAnchors(file);
 if(anchors.has(fragment))return true;
 try{return anchors.has(decodeURIComponent(fragment));}catch{return false;}
};

function scan(file,source){
 for(const [,link] of source.matchAll(/\[[^\]]*\]\(([^\s)]+)\)/g)){
  if(/^(?:https?:|mailto:)/.test(link))continue;
  const hash=link.indexOf('#');
  const raw=hash<0?link:link.slice(0,hash);
  const fragment=hash<0?null:link.slice(hash+1);
  let target;
  try{
   target=raw?path.resolve(path.dirname(file),decodeURIComponent(raw)):file;
  }catch{
   // A malformed percent escape must remain a report field, never an uncaught URIError.
   failures.push({file:path.relative(root,file),link,reason:'undecodable-link'});
   continue;
  }
  if(!raw){
   // A same-document fragment never needs a file existence check.
   if(fragment&&!hasAnchor(file,fragment))failures.push({file:path.relative(root,file),link,reason:'missing-anchor'});
   continue;
  }
  if(!fs.existsSync(target)){
   failures.push({file:path.relative(root,file),link});
   continue;
  }
  // Only markdown files define anchors; a fragment on any other target stays unvalidated.
  if(fragment&&/\.md$/i.test(target)&&fs.statSync(target).isFile()&&!hasAnchor(target,fragment))failures.push({file:path.relative(root,file),link,reason:'missing-anchor'});
 }
}

function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','.git','.private','.local'].includes(item.name))continue;
 const file=path.join(dir,item.name);if(item.isDirectory()){walk(file);continue;}if(!item.name.endsWith('.md'))continue;
 documents++;const source=fs.readFileSync(file,'utf8');
 scan(file,withoutInlineCode(withoutFences(source)));
}}
walk(root);console.log(JSON.stringify({passed:!failures.length,documents,failures},null,2));if(failures.length)process.exitCode=1;