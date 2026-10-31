import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import readline from 'node:readline';
import {spawn} from 'node:child_process';
import {pathToFileURL,fileURLToPath} from 'node:url';

/** Local-only bridge: DSH uses the existing Pi credential channel without receiving its key. */
export async function createModelForwarder(config){
 const sdk=await import(pathToFileURL(path.join(config.sdkRoot,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href);
 const runtime=await sdk.ModelRuntime.create({authPath:path.join(config.agentDir,'auth.json'),modelsPath:path.join(config.agentDir,'models.json'),modelsStorePath:path.join(config.agentDir,'models-store.json'),allowModelNetwork:false,refreshOnCreate:false});
 const model=runtime.getModel(config.provider,config.model);if(!model)throw Error('Exact configured model is unavailable');
 return async(body,signal)=>{if(body.model!==config.model)throw Error('Model substitution refused');const auth=await runtime.getAuth(model);if(!auth)throw Error('Existing model authentication is unavailable');
  const request=runtime.getCompatibilityRequestConfig(model),headers={'content-type':'application/json',...request.headers,...auth.auth.headers};if(auth.auth.apiKey&&request.authHeader)headers.authorization=`Bearer ${auth.auth.apiKey}`;
  const base=(auth.auth.baseUrl??model.baseUrl).replace(/\/$/,'');const payload={...body,model:config.model};
  return fetch(`${base}/chat/completions`,{method:'POST',headers,body:JSON.stringify(payload),signal});
 };
}
export async function serveModelGateway(config){let child,relay,forward;
 if(config.relay){child=spawn(config.relay.executable,[config.relay.script,'--stdio',config.relay.config],{stdio:['pipe','pipe','inherit'],windowsHide:true});const pending=new Map();
  readline.createInterface({input:child.stdout}).on('line',line=>{let m;try{m=JSON.parse(line)}catch{return}const p=pending.get(m.id);if(!p)return;if(m.start)p.start(m);else if(m.chunk)p.chunk(Buffer.from(m.chunk,'base64'));else if(m.end){pending.delete(m.id);p.end()}else if(m.error){pending.delete(m.id);p.error(Error(m.error))}});
  child.once('exit',()=>{for(const p of pending.values())p.error(Error('Model relay stopped'));pending.clear()});
  relay=(body,res)=>new Promise((resolve,reject)=>{const id=crypto.randomUUID();pending.set(id,{start:m=>{res.writeHead(m.status,{'content-type':m.contentType??'application/json'})},chunk:b=>res.write(b),end:()=>{res.end();resolve()},error:reject});res.on('close',()=>{if(pending.has(id)){pending.delete(id);child.stdin.write(JSON.stringify({id,cancel:true})+'\n');resolve()}});child.stdin.write(JSON.stringify({id,body})+'\n')});
 }else forward=await createModelForwarder(config);
 const server=http.createServer(async(req,res)=>{try{if(req.headers.authorization!==`Bearer ${config.bridgeToken}`){res.writeHead(401);res.end('Unauthorized');return}
  if(req.method==='GET'&&req.url==='/v1/models'){res.setHeader('content-type','application/json');res.end(JSON.stringify({object:'list',data:[{id:config.model,object:'model',owned_by:'configured-channel'}]}));return}
  if(req.method!=='POST'||req.url!=='/v1/chat/completions'){res.writeHead(404);res.end();return}
  let text='';for await(const chunk of req){text+=chunk;if(text.length>8*1024*1024)throw Error('Model request too large')}const body=JSON.parse(text);if(body.model!==config.model)throw Error('Model substitution refused');
  if(relay)await relay(body,res);else{const controller=new AbortController();res.on('close',()=>controller.abort());const response=await forward(body,controller.signal);res.writeHead(response.status,{'content-type':response.headers.get('content-type')??'application/json'});for await(const chunk of response.body)res.write(chunk);res.end()}
 }catch(error){if(!res.headersSent)res.writeHead(502,{'content-type':'application/json'});res.end(JSON.stringify({error:{message:String(error.message).replace(/\bsk[-_][\w-]+/g,'[redacted]')}}))}});
 await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port??3091,'127.0.0.1',resolve)});return{server,close:()=>{server.close();child?.kill()}};
}
async function main(){const args=process.argv.slice(2);if(args[0]==='--stdio'){const config=JSON.parse(fs.readFileSync(args[1],'utf8')),forward=await createModelForwarder(config),active=new Map();
  const write=value=>process.stdout.write(JSON.stringify(value)+'\n');readline.createInterface({input:process.stdin}).on('line',line=>{const m=JSON.parse(line);if(m.cancel){active.get(m.id)?.abort();return}const c=new AbortController();active.set(m.id,c);void forward(m.body,c.signal).then(async response=>{write({id:m.id,start:true,status:response.status,contentType:response.headers.get('content-type')});for await(const chunk of response.body)write({id:m.id,chunk:Buffer.from(chunk).toString('base64')});write({id:m.id,end:true})}).catch(error=>write({id:m.id,error:String(error.message).replace(/\bsk[-_][\w-]+/g,'[redacted]')})).finally(()=>active.delete(m.id))});
 }else if(args[0]==='--serve'){const service=await serveModelGateway(JSON.parse(fs.readFileSync(args[1],'utf8')));console.log(JSON.stringify({ready:true,loopback:true}));for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>service.close())}else throw Error('Use --serve <private config> or --stdio <private config>')}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url))await main();
