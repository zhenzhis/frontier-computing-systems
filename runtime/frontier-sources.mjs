import https from 'node:https';
import dns from 'node:dns/promises';
import net from 'node:net';
import tls from 'node:tls';
import {digest} from './superagent.mjs';

export const FRONTIER_TOPICS=['agents and harnesses','reasoning and planning','memory and retrieval','multi-agent coordination','evaluation and reliability','test-time compute','training and reinforcement learning','multimodal and computer use','inference systems','AI for science'];
export const DEFAULT_FRONTIER_SOURCES=[
 {id:'deepseek-superagent',kind:'github',repository:'deepseek-ai/dsh-superagent-prototype',intervalSeconds:900},
 {id:'deepseek-design',kind:'page',url:'https://x.com/DeepSeekHarness/status/2116857257245987236',intervalSeconds:21600},
 {id:'anthropic-research',kind:'page',url:'https://www.anthropic.com/research',intervalSeconds:3600},
 {id:'anthropic-engineering',kind:'page',url:'https://www.anthropic.com/engineering',intervalSeconds:3600},
 {id:'openai-research',kind:'feed',url:'https://openai.com/news/rss.xml',intervalSeconds:3600},
 {id:'google-research',kind:'feed',url:'https://research.google/blog/rss/',intervalSeconds:3600},
 {id:'deepmind',kind:'feed',url:'https://deepmind.google/blog/rss.xml',intervalSeconds:3600},
 {id:'huggingface',kind:'feed',url:'https://huggingface.co/blog/feed.xml',intervalSeconds:3600},
 {id:'arxiv-agents',kind:'feed',url:'https://export.arxiv.org/api/query?search_query=all:agent+AND+(cat:cs.AI+OR+cat:cs.CL)&sortBy=submittedDate&sortOrder=descending&max_results=10',intervalSeconds:14400},
 {id:'arxiv-systems',kind:'feed',url:'https://export.arxiv.org/api/query?search_query=cat:cs.LG+OR+cat:cs.DC+OR+cat:cs.CV&sortBy=submittedDate&sortOrder=descending&max_results=10',intervalSeconds:14400},
 {id:'github-agent-discovery',kind:'github-search',query:'topic:ai-agent archived:false',intervalSeconds:21600},
 {id:'github-eval-discovery',kind:'github-search',query:'topic:llm-evaluation archived:false',intervalSeconds:21600},
 {id:'github-systems-discovery',kind:'github-search',query:'topic:llm-inference archived:false',intervalSeconds:21600},
];
export function publicAddress(address){
 if(net.isIP(address)===4){const [a,b]=address.split('.').map(Number);return !(a===0||a===10||a===127||a>=224||(a===100&&b>=64&&b<=127)||(a===169&&b===254)||(a===172&&b>=16&&b<=31)||(a===192&&[0,168].includes(b))||(a===198&&[18,19,51].includes(b))||(a===203&&b===0));}
 // Refuse local, mapped, multicast and transition addresses, including ::ffff:7f00:1.
 return net.isIP(address)===6&&/^[23][0-9a-f]{3}:/i.test(address)&&!/^2002:/i.test(address)&&!/^2001:(?:0{1,4}|db8|0{0,3}2):/i.test(address);
}
export function publicURL(value){const u=new URL(value);if(u.protocol!=='https:'||u.username||u.password||(u.port&&u.port!=='443')||u.hostname==='localhost'||u.hostname.endsWith('.local')||u.hostname.endsWith('.internal')||/[?&](?:token|key|api_key|secret|authorization)=/i.test(u.search))throw Error('Only credential-free public HTTPS evidence is allowed');if(net.isIP(u.hostname.replace(/^\[|\]$/g,''))&&!publicAddress(u.hostname.replace(/^\[|\]$/g,'')))throw Error('Non-public address refused');u.hash='';return u.href;}

/** Credential-free GET with pinned public DNS, redirect validation, byte and time limits. */
export async function fetchPublic(value,{etag,signal,redirects=0}={}){
 signal=AbortSignal.any([signal??new AbortController().signal,AbortSignal.timeout(15000)]);
 signal.throwIfAborted();
 const url=publicURL(value),u=new URL(url),addresses=await dns.lookup(u.hostname,{all:true});if(!addresses.length||addresses.some(x=>!publicAddress(x.address)))throw Error('Evidence host resolves to a non-public address');
 const selected=addresses[0],headers={'user-agent':'FCS-Frontier-Research/1.0','accept':'application/json,application/atom+xml,application/rss+xml,text/html;q=0.8'};if(etag)headers['if-none-match']=etag;
 const ca=[...tls.getCACertificates('default'),...tls.getCACertificates('system')];
 const response=await new Promise((resolve,reject)=>{const req=https.get(url,{headers,signal,ca,lookup:(_host,opts,cb)=>opts?.all?cb(null,[selected]):cb(null,selected.address,selected.family)},res=>{let bytes=0;const chunks=[];res.on('data',chunk=>{bytes+=chunk.length;if(bytes>2*1024*1024){res.destroy(Error('Evidence exceeds 2 MiB'));return}chunks.push(chunk)});res.on('error',reject);res.on('end',()=>resolve({status:res.statusCode,headers:res.headers,text:Buffer.concat(chunks).toString('utf8'),url}));});req.setTimeout(12000,()=>req.destroy(Error('Evidence request timed out')));req.on('error',reject);});
 if([301,302,303,307,308].includes(response.status)){if(redirects>=3||!response.headers.location)throw Error('Evidence redirect limit');return fetchPublic(new URL(response.headers.location,url).href,{signal,redirects:redirects+1});}return response;
}
const unescape=text=>String(text).replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g,'$1').replace(/&(?:amp|lt|gt|quot|apos);/g,v=>({'&amp;':'&','&lt;':'<','&gt;':'>','&quot;':'"','&apos;':"'"})[v]);
export const plain=text=>unescape(String(text).replace(/<script\b[^>]*>[\s\S]*?<\/script>|<style\b[^>]*>[\s\S]*?<\/style>/gi,' ')).replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').trim();
function tag(text,name){return unescape(text.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`,'i'))?.[1]??'');}
export function feedItems(text){const blocks=text.match(/<(?:entry|item)\b[^>]*>[\s\S]*?<\/(?:entry|item)>/gi);if(!blocks)throw Error('No RSS/Atom entries; retain the previous snapshot');return blocks.slice(0,20).map(block=>({title:plain(tag(block,'title')),url:tag(block,'link')||block.match(/<link\b[^>]*href=["']([^"']+)["']/i)?.[1]||tag(block,'id'),published:tag(block,'published')||tag(block,'pubDate')||tag(block,'updated'),excerpt:plain(tag(block,'summary')||tag(block,'description')||tag(block,'content')).slice(0,9000)})).filter(x=>/^https?:\/\//.test(x.url)).map(x=>({...x,url:x.url.replace(/^http:/,'https:')}));}
export async function readSource(source,{request=fetchPublic,etag,signal}={}){
 let url=source.url;
 if(source.kind==='github'){if(!/^[\w.-]+\/[\w.-]+$/.test(source.repository))throw Error('Invalid repository');url=`https://api.github.com/repos/${source.repository}/commits?per_page=1`;}
 if(source.kind==='github-search')url='https://api.github.com/search/repositories?q='+encodeURIComponent(source.query)+'&sort=updated&order=desc&per_page=10';
 const response=await request(url,{etag,signal});if(response.status===304)return{unchanged:true,etag};if(response.status!==200)throw Error(`Evidence HTTP ${response.status}`);
 let items;
 if(source.kind==='github'){const row=JSON.parse(response.text)[0];if(!row?.sha)throw Error('Missing upstream commit');const detail=await request(`https://api.github.com/repos/${source.repository}/commits/${row.sha}`,{signal});if(detail.status!==200)throw Error(`Upstream diff HTTP ${detail.status}`);const change=JSON.parse(detail.text);if(change.sha!==row.sha||!Array.isArray(change.files))throw Error('Upstream diff identity mismatch');items=[{url:`https://github.com/${source.repository}/commit/${row.sha}`,title:row.commit.message.split('\n')[0],version:row.sha,published:row.commit.committer.date,excerpt:(row.commit.message+'\nSource changes (bounded excerpt; inspect full pinned source before adoption):\n'+change.files.map(f=>`${f.status} ${f.filename}\n${f.patch??'[binary, large or omitted patch]'}`).join('\n')).slice(0,18000)}];}
 else if(source.kind==='github-search'){const rows=JSON.parse(response.text).items;if(!Array.isArray(rows))throw Error('Invalid repository search');items=rows.map(x=>({url:x.html_url,title:x.full_name,published:x.pushed_at,version:x.pushed_at,excerpt:x.description??''}));}
 else if(source.kind==='feed')items=feedItems(response.text);
 else if(source.kind==='page'){
  if(new URL(url).hostname==='x.com'&&!response.text.includes('Towards a More Autonomous Agent'))throw Error('X article body unavailable; retain the last independently captured article');
  const excerpt=plain(response.text);if(excerpt.length<100||/^(?:.{0,120})(?:Just a moment|Access Denied|Enable JavaScript)/i.test(excerpt))throw Error('Article inaccessible; no successful reading claimed');
  const title=plain(tag(response.text,'title'))||source.id;
  // Watch index links as well as page text: a new research article becomes its own evidence item.
  const links=[...response.text.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)].map(m=>({url:new URL(unescape(m[1]),url).href,title:plain(m[2])})).filter(x=>x.title.length>15&&new URL(x.url).hostname===new URL(url).hostname&&/research|engineering|blog|article|news/.test(new URL(x.url).pathname)).slice(0,20);
  items=[{url,title,excerpt:excerpt.slice(0,12000),body:excerpt.slice(0,120000),bodyTruncated:excerpt.length>120000},...links.map(x=>({...x,excerpt:'Index discovery; linked article has not yet been read.'}))];
 }else throw Error('Unknown frontier source kind');
 return{etag:response.headers?.etag??null,items:items.map(item=>{const url=publicURL(item.url);return{...item,url,hash:digest({title:item.title,url,version:item.version??null,excerpt:item.excerpt,body:item.body??null})}})};
}
