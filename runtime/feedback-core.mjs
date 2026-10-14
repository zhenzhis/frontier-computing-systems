import fs from 'node:fs';
import path from 'node:path';
import {ProjectStore,hash,safeData} from './control.mjs';
export async function collectFeedback(project,repo,{stateRoot,fetcher=fetch}={}){
 if(!/^[-\w.]+\/[-\w.]+$/.test(repo))throw Error('Expected owner/repo');
 const store=new ProjectStore(project,stateRoot?{stateRoot}:{}),prefix=path.join(store.root,'feedback-'+hash(repo).slice(0,12)),cursorFile=prefix+'.json',leaseFile=prefix+'.lock';
 fs.mkdirSync(store.root,{recursive:true});
 let lease;try{lease=fs.openSync(leaseFile,'wx');}catch(e){if(e.code==='EEXIST')throw Error('Feedback collector lock present; no concurrent cursor update');throw e;}
 try{
  fs.writeFileSync(lease,JSON.stringify({pid:process.pid,repo,startedAt:new Date().toISOString()}));fs.fsyncSync(lease);
  const cursor=fs.existsSync(cursorFile)?JSON.parse(fs.readFileSync(cursorFile,'utf8')):{};
  const url=new URL(`https://api.github.com/repos/${repo}/issues`);for(const [k,v] of Object.entries({state:'all',sort:'updated',direction:'asc',per_page:'30',page:String(cursor.page??1)}))url.searchParams.set(k,v);if(cursor.lastUpdated)url.searchParams.set('since',cursor.lastUpdated);
  const response=await fetcher(url,{headers:{'User-Agent':'Pi-WF7-local-feedback','Accept':'application/vnd.github+json',...(cursor.etag&&cursor.url===url.href?{'If-None-Match':cursor.etag}:{})},signal:AbortSignal.timeout(20000)});
  if(response.status===304)return {changed:false,modelRequests:0,externalReplies:0};
  if(!response.ok)throw Error('Public feedback fetch failed: '+response.status);
  const rows=await response.json();if(!Array.isArray(rows)||rows.length>30)throw Error('Unexpected feedback page');let accepted=0,rejected=0;
  for(const row of rows){try{const result=store.ingest({source:`github:${repo}`,eventId:String(row.id),revision:row.updated_at,payload:safeData({title:row.title,url:row.html_url,state:row.state,kind:row.pull_request?'pull-request':'issue',summary:(row.body??'').slice(0,3000)})});if(!result.duplicate)accepted++;}catch(e){if(!e.message.includes('credential'))throw e;rejected++;}}
  const next=rows.length===30?{lastUpdated:cursor.lastUpdated??null,page:(cursor.page??1)+1,pendingLastUpdated:rows.at(-1).updated_at}:{lastUpdated:rows.at(-1)?.updated_at??cursor.pendingLastUpdated??cursor.lastUpdated??null,page:1};
  const temp=prefix+'.tmp-'+process.pid,fd=fs.openSync(temp,'w');try{fs.writeFileSync(fd,JSON.stringify({...next,etag:response.headers.get('etag'),url:url.href,repo,checkedAt:new Date().toISOString()})+'\n');fs.fsyncSync(fd);}finally{fs.closeSync(fd);}fs.renameSync(temp,cursorFile);
  return {accepted,rejected,modelRequests:0,pageLimited:rows.length===30,externalReplies:0};
 }finally{fs.closeSync(lease);fs.unlinkSync(leaseFile);}
}
