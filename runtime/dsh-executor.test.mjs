import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {runDshWorker} from './dsh-executor.mjs';

async function fixture(mismatch,{metadata=false}={}){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fcs-dsh-')),queue=path.join(root,'queue'),workspace=path.join(root,'work','candidate'),candidate=path.join(root,'candidate');fs.mkdirSync(queue);fs.mkdirSync(path.join(workspace,'.local'),{recursive:true});fs.mkdirSync(candidate);fs.writeFileSync(path.join(workspace,'file.txt'),'delivered');
 if(metadata){fs.writeFileSync(path.join(workspace,'release-manifest.json'),'worker-supplied hashes');fs.writeFileSync(path.join(candidate,'release-manifest.json'),'supervisor-owned manifest')}
 let sent=false;const timer=setInterval(()=>{if(sent)return;const file=fs.readdirSync(queue).find(f=>f.endsWith('.request.json'));if(!file)return;sent=true;const request=JSON.parse(fs.readFileSync(path.join(queue,file),'utf8'));fs.writeFileSync(path.join(workspace,'.local','fcs-assignment.json'),JSON.stringify({requestId:request.id,base:request.base,nativeTicketId:request.nativeTicketId}));fs.writeFileSync(path.join(queue,request.id+'.result.json'),JSON.stringify({requestId:request.id,base:mismatch?'other':request.base,nativeTicketId:request.nativeTicketId,completed:true,directory:workspace,changed:metadata?['file.txt','release-manifest.json']:['file.txt'],summary:'fixture',ticketId:'fixture'}))},10);
 try{return{result:await runDshWorker({queue,allowedWorkspaceRoot:path.join(root,'work'),nativeTicketId:'fixture',project:candidate,base:'frozen-revision',sourceRepository:'fixture',plan:{files:['file.txt']},prompt:'fixture',signal:AbortSignal.timeout(10000)}),candidate,queue}}finally{clearInterval(timer)}
}
test('DSH handback binds the exact request and base, copies only assigned files and archives delivery evidence',async()=>{const{result,candidate,queue}=await fixture(false);assert.equal(result.completed,true);assert.equal(fs.readFileSync(path.join(candidate,'file.txt'),'utf8'),'delivered');assert(fs.existsSync(path.join(queue,'archive',result.requestId,result.requestId+'.result.json')));assert.equal(fs.readdirSync(queue).filter(f=>f.endsWith('.request.json')).length,0)});
test('a DSH handback from another source revision cannot change the native candidate',async()=>{await assert.rejects(fixture(true),/immutable assignment/)});
test('worker-generated release hashes are discarded while assigned source is delivered',async()=>{const{candidate}=await fixture(false,{metadata:true});assert.equal(fs.readFileSync(path.join(candidate,'file.txt'),'utf8'),'delivered');assert.equal(fs.readFileSync(path.join(candidate,'release-manifest.json'),'utf8'),'supervisor-owned manifest')});
