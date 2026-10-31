import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import {Autopilot,acquireWriter} from './autopilot.mjs';
const args=process.argv.slice(2),i=args.indexOf('--config');
if(i<0||!args.includes('--execute')){console.error('Explicit --config <private config> --execute required; importing/installing does not start automation.');process.exit(1)}
const configFile=path.resolve(args[i+1]),config=JSON.parse(fs.readFileSync(configFile,'utf8'));
const pilot=new Autopilot(config.project,config,{stateRoot:config.stateRoot});
const release=acquireWriter(path.join(pilot.store.root,'service'),'service',{recoverDead:true});
if(!pilot.store.config().revision)pilot.store.configure({authorization:config.authorization,mode:config.mode??'auto',allowed:config.allowed??['local:maintainer'],sources:['local','repository','github'],rules:[{id:'improve-fcs',enabled:true,scope:config.scope}],paused:false,evalTimeoutMs:((config.cycleMinutes??30)*60+60)*1000});
if(pilot.store.config().authorization!==config.authorization)throw Error('Stored authorization differs from the service configuration; reconcile explicitly before starting');
pilot.store.recover();let ticking=false,closed=false;
const server=http.createServer(async(req,res)=>{try{
 const hosts=new Set([`127.0.0.1:${config.port??3083}`,`localhost:${config.port??3083}`]);if(!hosts.has(req.headers.host))throw Error('Foreign host refused');const origin=req.headers.origin;if(origin&&!new Set([...hosts].map(host=>`http://${host}`)).has(origin))throw Error('Foreign origin refused');
 if(req.url==='/'){res.setHeader('Content-Type','text/html;charset=utf-8');res.end(fs.readFileSync(path.join(import.meta.dirname,'superagent-panel.html')));return}
 if(req.headers['x-fcs-request']!=='1')throw Error('Local API request header required');
 res.setHeader('Content-Type','application/json');
 if(req.method==='GET'&&req.url==='/api/status'){res.end(JSON.stringify({...pilot.store.status(),model:config.model,running:pilot.running.size,failures:pilot.store.list('failure').slice(-10),results:pilot.store.list('result').slice(-10)}));return}
 let body='';for await(const chunk of req){body+=chunk;if(body.length>128000)throw Error('Request too large')}
 const data=body?JSON.parse(body):{};let value;
 if(req.method==='POST'&&req.url==='/api/event')value=pilot.store.receive(data);
 else if(req.method==='POST'&&['/api/pause','/api/resume'].includes(req.url)){const c=pilot.store.config();value=pilot.store.configure({...c,paused:req.url.endsWith('pause')},c.revision);if(value.paused)pilot.cancelCurrent()}
 else if(req.method==='POST'&&req.url==='/api/stop'){value=pilot.store.engine.stopTicket(data.ticketId,'Explicit operator stop');pilot.running.get(data.ticketId)?.controller.abort()}
 else if(req.method==='GET'&&req.url.startsWith('/api/read?'))value=pilot.store.reference(new URL(req.url,'http://localhost').searchParams.get('reference'));
 else{res.statusCode=404;value={error:'Unknown route'}}res.end(JSON.stringify(value));
 }catch(error){res.statusCode=400;res.end(JSON.stringify({error:String(error.message)}))}});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.port??3083,'127.0.0.1',resolve)});
const timer=setInterval(async()=>{if(ticking||closed)return;ticking=true;try{if(fs.existsSync(path.join(pilot.store.root,'STOP'))){const c=pilot.store.config();if(!c.paused)pilot.store.configure({...c,paused:true},c.revision);pilot.cancelCurrent();return}await pilot.tick()}catch(error){pilot.record('failure',{source:'service',error:String(error.message)})}finally{ticking=false}},2000);
async function shutdown(){if(closed)return;closed=true;clearInterval(timer);pilot.stop();server.close();while(pilot.pending.size)await new Promise(r=>setTimeout(r,100));pilot.store.close();release()}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>void shutdown());
console.log(JSON.stringify({ready:true,url:`http://127.0.0.1:${config.port??3083}`,exactModel:config.model,automatic:true}));
