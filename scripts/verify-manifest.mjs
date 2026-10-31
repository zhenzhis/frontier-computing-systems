import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {fileURLToPath} from 'node:url';

// One exclusion set for both directions. `--write` collects release inputs with
// it and verification walks the same set, so a written manifest and a verified
// tree can never disagree about which paths count as release inputs.
const excludedDirectories=['.git','node_modules','.local','.private','.workflow','state','sessions','backups','coverage'];
const excludedFiles=['release-manifest.json','validation.local.json'];

const rootIndex=process.argv.indexOf('--root');
const root=rootIndex>=0?fs.realpathSync(process.argv[rootIndex+1]):path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const file=path.join(root,'release-manifest.json');
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
const packageVersion=()=>JSON.parse(fs.readFileSync(path.join(root,'package.json'))).version;
// Every regular file below the root except the exclusions above. Symlinks are
// refused because they would make the manifest depend on something outside it.
const collect=()=>{const files=[];const walk=d=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){if(excludedDirectories.includes(e.name))continue;const p=path.join(d,e.name);if(e.isSymbolicLink())throw Error(`Symlinks are not release inputs: ${path.relative(root,p)}`);if(e.isDirectory())walk(p);else if(!excludedFiles.includes(e.name))files.push({path:path.relative(root,p).replaceAll('\\','/'),sha256:sha(p)});}};walk(root);return files.sort((a,b)=>a.path.localeCompare(b.path));};
if(process.argv.includes('--write')){
 const files=collect();
 fs.writeFileSync(file,JSON.stringify({schemaVersion:1,version:packageVersion(),baseWorkflow:'WF7',intentRouting:'deferred',files},null,2)+'\n');
 console.log(JSON.stringify({written:true,files:files.length}));
}else{
 const m=JSON.parse(fs.readFileSync(file));
 // Listed files must still exist with the recorded bytes.
 const failures=m.files.filter(e=>!fs.existsSync(path.join(root,e.path))||sha(path.join(root,e.path))!==e.sha256).map(e=>e.path);
 // Reverse direction: every collected release input must be registered, so an
 // added-but-unregistered source file cannot pass silently.
 let unlisted=[];
 try{const listed=new Set(m.files.map(e=>e.path));unlisted=collect().map(e=>e.path).filter(p=>!listed.has(p));}catch(error){failures.push(`unwalkable-tree: ${error.message}`);}
 if(m.version!==packageVersion())failures.push('package-version');
 const passed=!failures.length&&!unlisted.length;
 console.log(JSON.stringify({passed,version:m.version,checkedFiles:m.files.length,failures,unlisted},null,2));
 if(!passed)process.exitCode=1;
}
