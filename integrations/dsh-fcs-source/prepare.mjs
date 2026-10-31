import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {execFileSync} from 'node:child_process';
import {executionPath} from './paths.mjs';

const [stateDir,queue,coordination]=process.argv.slice(2),ticketId=process.env.DSH_SUPERAGENT_TICKET,directory=process.env.DSH_SUPERAGENT_DIR;
if(!stateDir||!queue||!coordination||!ticketId||!directory)throw Error('DSH prepare requires explicit state, queue, coordination and ticket environment');
const db=new DatabaseSync(path.join(stateDir,'orchestrator.sqlite'),{readOnly:true});
const ticket=JSON.parse(db.prepare('SELECT value FROM ticket WHERE id=?').get(ticketId).value),trigger=JSON.parse(db.prepare('SELECT value FROM trigger WHERE id=?').get(ticket.origin.triggerId).value);db.close();
if(trigger.source!=='fcs'||!/^[a-zA-Z0-9-]+$/.test(trigger.meta.requestId))throw Error('Execution must originate in the authorized FCS controller queue');
const request=JSON.parse(fs.readFileSync(path.join(queue,`${trigger.meta.requestId}.request.json`),'utf8'));
const lease=JSON.parse(fs.readFileSync(path.join(coordination,'writer.json'),'utf8'));if(lease.owner!==`pi:${request.nativeTicketId}`)throw Error('FCS controller does not own the writer lease');
const repository=executionPath(request.sourceRepository);
if(fs.existsSync(directory))throw Error('Prepare destination already exists; preserve it for inspection');
execFileSync('git',['clone','--no-hardlinks','--no-checkout',repository,directory],{stdio:'inherit'});
execFileSync('git',['-C',directory,'checkout','--detach',request.base],{stdio:'inherit'});
fs.mkdirSync(path.join(directory,'.local'),{recursive:true});fs.writeFileSync(path.join(directory,'.local','fcs-assignment.json'),JSON.stringify({requestId:request.id,nativeTicketId:request.nativeTicketId,base:request.base,files:request.files}));
