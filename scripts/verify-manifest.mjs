import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'release-manifest.json');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
if(process.argv.includes('--write')){
 const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(['.git','node_modules','.local','.private','state','sessions','backups'].includes(e.name))continue;const p=path.join(d,e.name);if(e.isSymbolicLink())throw Error('Symlinks are not release inputs');if(e.isDirectory())walk(p);else if(!['release-manifest.json','validation.local.json'].includes(e.name))files.push({path:path.relative(root,p).replaceAll('\\','/'),sha256:sha(p)});}};walk(root);
 fs.writeFileSync(file,JSON.stringify({schemaVersion:1,version:JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version,baseWorkflow:'WF7',intentRouting:'deferred',files:files.sort((a,b)=>a.path.localeCompare(b.path))},null,2)+'\n');
 console.log(JSON.stringify({written:true,files:files.length}));
}else{
 const m=JSON.parse(fs.readFileSync(file));const failures=m.files.filter(e=>!fs.existsSync(path.join(root,e.path))||sha(path.join(root,e.path))!==e.sha256).map(e=>e.path);
 if(m.version!==JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version)failures.push('package-version');
 console.log(JSON.stringify({passed:!failures.length,version:m.version,checkedFiles:m.files.length,failures},null,2));if(failures.length)process.exitCode=1;
}
