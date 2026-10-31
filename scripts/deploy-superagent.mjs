import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {command,npmCli} from '../runtime/autopilot.mjs';

const args=process.argv.slice(2),arg=name=>args[args.indexOf(name)+1];
if(!args.includes('--apply')||!args.includes('--config')||!args.includes('--candidate')||!args.includes('--artifacts'))throw Error('Explicit --config, --candidate, --artifacts and --apply required');
const config=JSON.parse(fs.readFileSync(path.resolve(arg('--config')),'utf8')),candidate=fs.realpathSync(arg('--candidate')),artifacts=path.resolve(arg('--artifacts'));
const hash=file=>fs.existsSync(file)?crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex'):null;
const atomicWrite=(file,text)=>{const tmp=file+'.'+crypto.randomUUID()+'.tmp';fs.writeFileSync(tmp,text);fs.renameSync(tmp,file)};
const privateFiles=['settings.json','auth.json','models.json','models-store.json','mcp.json','mcp-auth.json'];
const before=Object.fromEntries(privateFiles.map(f=>[f,hash(path.join(config.agentDir,f))]));
const identity=hash(path.join(candidate,'release-manifest.json')),destination=path.join(path.resolve(config.deployRoot),'versions',identity);
if(destination.toLowerCase().startsWith(candidate.toLowerCase()+path.sep))throw Error('Deployment must be outside the candidate');
fs.mkdirSync(artifacts,{recursive:true});
if(!fs.existsSync(destination)){const stage=destination+'.'+crypto.randomUUID()+'.tmp';fs.cpSync(candidate,stage,{recursive:true,filter:file=>!path.relative(candidate,file).split(path.sep).some(x=>['.git','node_modules','.private','.local','state','sessions','backups'].includes(x))});fs.renameSync(stage,destination);}
const log=path.join(artifacts,'local-deployment.log'),npm=npmCli();
for(const cmd of [[npm,'ci','--ignore-scripts','--no-audit','--no-fund'],[path.join(destination,'scripts/verify-manifest.mjs')],[path.join(destination,'scripts/verify-sdk.mjs')]]){
 const r=await command(process.execPath,cmd,{cwd:destination,log});if(!r.passed)throw Error('Installed source/SDK verification failed; active extension remains unchanged');
}
const sdk=await import(pathToFileURL(path.join(destination,'node_modules/@earendil-works/pi-coding-agent/dist/index.js')).href);
const wrapper=path.join(config.agentDir,'extensions','workflow-superagent','index.ts'),journal=path.join(config.deployRoot,'pending-switch.json');
if(fs.existsSync(journal)){const pending=JSON.parse(fs.readFileSync(journal,'utf8'));if(pending.stage==='switching'){if(hash(wrapper)!==pending.newHash&&hash(wrapper)!==pending.oldHash)throw Error('Pending extension switch has unrelated drift; preserve it');if(hash(wrapper)===pending.newHash){if(pending.old===null)fs.unlinkSync(wrapper);else atomicWrite(wrapper,Buffer.from(pending.old,'base64'))}}}
const old=fs.existsSync(wrapper)?fs.readFileSync(wrapper):null;
if(old)fs.writeFileSync(path.join(artifacts,'previous-extension.ts'),old);
const implementation=pathToFileURL(path.join(destination,'managed/extensions/workflow-superagent/index.ts')).href;
const text=`export default async function(pi:any){const integration=await import(${JSON.stringify(implementation)});return integration.default(pi)}\n`;
fs.mkdirSync(path.dirname(wrapper),{recursive:true});atomicWrite(journal,JSON.stringify({stage:'switching',old:old?.toString('base64')??null,oldHash:hash(wrapper),newHash:crypto.createHash('sha256').update(text).digest('hex')}));atomicWrite(wrapper,text);
let session;
try{
 const isolated=path.join(artifacts,'active-entry-smoke');fs.mkdirSync(isolated,{recursive:true});const project=path.join(isolated,'project');fs.mkdirSync(project,{recursive:true});
 const settings=sdk.SettingsManager.inMemory({packages:[]});const runtime=await sdk.ModelRuntime.create({authPath:path.join(isolated,'auth.json'),modelsPath:null,modelsStorePath:path.join(isolated,'models-store.json'),allowModelNetwork:false,refreshOnCreate:false});
 const loader=new sdk.DefaultResourceLoader({cwd:project,agentDir:isolated,settingsManager:settings,noContextFiles:true,additionalExtensionPaths:[wrapper]});await loader.reload();const created=await sdk.createAgentSession({cwd:project,agentDir:isolated,settingsManager:settings,modelRuntime:runtime,resourceLoader:loader,sessionManager:sdk.SessionManager.inMemory(project)});session=created.session;
 if(created.extensionsResult.errors.length)throw Error('Actual active extension entry failed to load');const notices=[];await session.bindExtensions({mode:'rpc',uiContext:{hasUI:false,notify:(m,t)=>notices.push({m,t}),setStatus:()=>{}},onError:e=>{throw Error(JSON.stringify(e))}});
 await session.extensionRunner.getCommand('workflow-superagent').handler('status',session.extensionRunner.createCommandContext());if(notices.some(n=>n.t==='error'))throw Error('Actual active extension status failed');
 const {runModelRole}=await import(pathToFileURL(path.join(destination,'runtime/superagent-model.mjs')).href);fs.writeFileSync(path.join(project,'AGENTS.md'),'Read-only local deployment fixture.');fs.writeFileSync(path.join(project,'evidence.txt'),'FCS_DEPLOYED_READY');
 const probe=await runModelRole({project,agentDir:config.agentDir,provider:config.provider,model:config.model,role:'reviewer',stateDir:path.join(isolated,'model'),prompt:'Read evidence.txt, then call fcs_report with {observed:<exact file contents>}.',signal:AbortSignal.timeout(120000)});if(probe.observed!=='FCS_DEPLOYED_READY')throw Error('Installed model/tool loop failed');
 const after=Object.fromEntries(privateFiles.map(f=>[f,hash(path.join(config.agentDir,f))]));if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Personal configuration changed during deployment; preserve and investigate drift');
 const receipt={passed:true,at:new Date().toISOString(),destination,manifestSha256:identity,extensionEntry:wrapper,extensionSha256:hash(wrapper),activeEntryLoaded:true,readOnlyStatusInvoked:true,installedModelToolLoopPassed:true,personalConfigurationUnchanged:true,existingSessionsReloaded:false};
 atomicWrite(path.join(artifacts,'deployment.json'),JSON.stringify(receipt,null,2));atomicWrite(path.join(config.deployRoot,'active-code.json'),JSON.stringify(receipt,null,2));atomicWrite(journal,JSON.stringify({stage:'committed',receipt:path.join(artifacts,'deployment.json')}));console.log(JSON.stringify({passed:true,activeEntryLoaded:true,modelToolLoop:true,personalConfigurationUnchanged:true}));
}catch(error){if(hash(wrapper)===crypto.createHash('sha256').update(text).digest('hex')){if(old)atomicWrite(wrapper,old);else fs.unlinkSync(wrapper)}throw error}finally{await session?.dispose()}
