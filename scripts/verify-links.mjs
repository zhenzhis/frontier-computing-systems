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

// Link syntax has two independent nesting dimensions, and a single regex cannot see
// both. Link text may contain brackets of its own — a badge is
// [![alt](image.svg)](target) — and a destination may contain balanced parentheses.
// The previous pattern \[[^\]]*\]\(([^\s)]+)\) consumed `[![alt](image.svg)` and stopped
// at the inner `)`, leaving `](target)` without a `[` to match: the outer target of
// every badge-shaped link was never inspected, so renaming LICENSE or package.json
// left the gate green. The scanner below walks one construct at a time instead of
// matching it: bracket depth finds the end of the label, parenthesis depth finds the
// end of the destination, and constructs nested inside a label are visited before the
// outer one so every layer is checked exactly once in document order.
const punctuation=new Set("!\"#$%&'()*+,-./:;<=>?@[\\]^_`{|}~");
const escaped=(text,index)=>text[index]==='\\'&&punctuation.has(text[index+1]??'');

// A backslash escape makes the following punctuation literal, so `\]` does not end a
// label and `\(` does not open a destination. Escaped punctuation is resolved before
// the path check so a real `a)b.md` file is found; ordinary path separators such as
// `docs\file.md` stay untouched because the next character is not punctuation.
const unescapeMarkdown=value=>{
 let out='';
 for(let i=0;i<value.length;i++){
  if(escaped(value,i)){out+=value[i+1];i++;continue;}
  out+=value[i];
 }
 return out;
};

// Link text may wrap onto the next line, but a blank line ends the paragraph: an
// unmatched `[` must not keep searching for a `]` in the next section.
const blankLineAt=(text,index,limit)=>{
 for(let i=index+1;i<limit;i++){
  const ch=text[i];
  if(ch==='\n')return true;
  if(ch!==' '&&ch!=='\t'&&ch!=='\r')return false;
 }
 return false;
};

// Depth-aware label scan: `[a [b] c](x.md)` closes on the bracket whose depth returns
// to zero, and an unterminated label yields -1 instead of throwing.
function labelEnd(text,start,limit){
 let depth=0;
 for(let i=start;i<limit;i++){
  if(escaped(text,i)){i++;continue;}
  const ch=text[i];
  if(ch==='\n'&&blankLineAt(text,i,limit))return -1;
  if(ch==='['){depth++;continue;}
  if(ch!==']')continue;
  depth--;
  if(depth===0)return i;
 }
 return -1;
}

// A destination has three shapes that must stay distinguishable: a plain path, an
// angle-bracket path that may contain spaces, and either shape followed by a quoted
// title. Returning null on the first whitespace, as the previous scan did, silently
// treated `[docs](missing.md "Title")` and `[docs](<missing dir/x.md>)` as prose and
// never checked their targets. A construct is only accepted when the destination and
// optional title are closed by this link's `)`, so `[a](see the docs)` stays
// unchecked instead of turning into a new false positive; unterminated constructs
// still yield null, never an error.
const horizontalSpace=/[ \t\r]/;

// After a destination CommonMark permits whitespace and then a title in double or
// single quotes, followed by whitespace and the closing `)`. `bareClose` also accepts
// a plain `)` directly after an angle-bracket destination.
function closeAfterDestination(text,index,limit,bareClose){
 let i=index;
 while(i<limit&&horizontalSpace.test(text[i]))i++;
 if(i>=limit)return -1;
 if(text[i]===')')return bareClose?i:-1;
 const quote=text[i];
 if(quote!=='"'&&quote!=="'")return -1;
 for(i++;i<limit;i++){
  if(escaped(text,i)){i++;continue;}
  const ch=text[i];
  if(ch==='\n')return -1;
  if(ch!==quote)continue;
  i++;
  while(i<limit&&horizontalSpace.test(text[i]))i++;
  return i<limit&&text[i]===')'?i:-1;
 }
 return -1;
}

// Depth-aware destination scan: `docs/a(b).md` ends at the `)` whose depth returns to
// zero, so a real file name may contain parentheses. Whitespace at the top level is
// only accepted when it introduces a quoted title; whitespace inside the destination
// or content after a title that is not the closing `)` still yields null.
function destination(text,open,limit){
 if(open+1<limit&&text[open+1]==='<'){
  for(let i=open+2;i<limit;i++){
   if(escaped(text,i)){i++;continue;}
   const ch=text[i];
   if(ch==='\n'||ch==='<')return null;
   if(ch==='>'){
    const end=closeAfterDestination(text,i+1,limit,true);
    if(end<0)return null;
    return {end,value:text.slice(open+2,i)};
   }
  }
  return null;
 }
 let depth=0;
 for(let i=open;i<limit;i++){
  if(escaped(text,i)){i++;continue;}
  const ch=text[i];
  if(ch==='('){depth++;continue;}
  if(ch===')'){depth--;if(depth===0)return {end:i,value:text.slice(open+1,i)};continue;}
  if(ch==='\n')return null;
  if(horizontalSpace.test(ch)){
   if(depth!==1)return null;
   const end=closeAfterDestination(text,i,limit,false);
   if(end<0)return null;
   return {end,value:text.slice(open+1,i)};
  }
  if(/\s/.test(ch))return null;
 }
 return null;
}

function check(file,link){
 if(/^(?:https?:|mailto:)/.test(link))return;
 const hash=link.indexOf('#');
 const raw=hash<0?link:link.slice(0,hash);
 const fragment=hash<0?null:link.slice(hash+1);
 let target;
 try{
  target=raw?path.resolve(path.dirname(file),decodeURIComponent(raw)):file;
 }catch{
  // A malformed percent escape must remain a report field, never an uncaught URIError.
  failures.push({file:path.relative(root,file),link,reason:'undecodable-link'});
  return;
 }
 if(!raw){
  // A same-document fragment never needs a file existence check.
  if(fragment&&!hasAnchor(file,fragment))failures.push({file:path.relative(root,file),link,reason:'missing-anchor'});
  return;
 }
 if(!fs.existsSync(target)){
  failures.push({file:path.relative(root,file),link});
  return;
 }
 // Only markdown files define anchors; a fragment on any other target stays unvalidated.
 if(fragment&&/\.md$/i.test(target)&&fs.statSync(target).isFile()&&!hasAnchor(target,fragment))failures.push({file:path.relative(root,file),link,reason:'missing-anchor'});
}

function scan(file,source){
 const text=source;
 // Each [ starts a candidate; the label is scanned first so nested constructs are
 // reported once, in the order their destinations appear in the source.
 const visit=(from,to)=>{
  for(let i=from;i<to;i++){
   if(escaped(text,i)){i++;continue;}
   if(text[i]!=='[')continue;
   const close=labelEnd(text,i,to);
   if(close<0)continue;
   const open=text[close+1]==='('&&close+1<to?destination(text,close+1,to):null;
   visit(i+1,close);
   if(open&&open.value)check(file,unescapeMarkdown(open.value));
   // Skip past the construct already handled: its `)(...)` and its label text.
   i=open?open.end:close;
  }
 };
 visit(0,text.length);
}

function walk(dir){for(const item of fs.readdirSync(dir,{withFileTypes:true})){
 if(['node_modules','.git','.private','.local'].includes(item.name))continue;
 const file=path.join(dir,item.name);if(item.isDirectory()){walk(file);continue;}if(!item.name.endsWith('.md'))continue;
 documents++;const source=fs.readFileSync(file,'utf8');
 scan(file,withoutInlineCode(withoutFences(source)));
}}
walk(root);console.log(JSON.stringify({passed:!failures.length,documents,failures},null,2));if(failures.length)process.exitCode=1;