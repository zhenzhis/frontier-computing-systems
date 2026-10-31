import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {audit,inspect,rules} from '../scripts/audit-public.mjs';

// Samples are assembled at run time on purpose: `node scripts/audit-public.mjs`
// scans this file too, so a literal home path or key here would be the very leak
// the rule reports. Interpolation keeps both the fixtures and this file clean.
const posixHome=(mount,name,rest)=>`${mount}/${name}/${rest}`;
const macHome=(name,rest)=>posixHome('/Users',name,rest);
const linuxHome=(name,rest)=>posixHome('/home',name,rest);
const windowsHome=(name,rest)=>`C:\\Users\\${name}\\${rest}`;
const authPath='.pi/agent/auth.json';

const fixture=t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'fcs-audit-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return root;
};
const place=(root,relative,content)=>{
 const target=path.join(root,relative);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,content);
};
const shape=report=>report.failures.map(f=>({file:f.file,rules:f.rules})).sort((a,b)=>a.file.localeCompare(b.file));

// One positive sample per exported rule id. A rule added without a sample here
// fails the first test, so a new pattern cannot ship unexercised.
const positives=new Map([
 ['provider-key',['sk','A'.repeat(32)].join('-')],
 ['github-token',['ghp','B'.repeat(36)].join('_')],
 ['github-fine-grained',['github','pat','C'.repeat(36)].join('_')],
 ['private-key',['-----BEGIN','OPENSSH PRIVATE KEY-----'].join(' ')],
 ['oauth-value',JSON.stringify({access_token:'D'.repeat(24)})],
 ['personal-home',windowsHome('alice','.pi\\agent\\auth.json')],
]);

test('every exported rule fires on its own positive sample and reports nothing else',()=>{
 const ids=rules.map(([id])=>id);
 for(const id of ids)assert.ok(positives.has(id),`exported rule ${id} has no positive sample`);
 for(const id of positives.keys())assert.ok(ids.includes(id),`sample ${id} matches no exported rule`);
 for(const [id,sample] of positives)assert.deepEqual(inspect('docs/note.md',sample),[id],`sample for ${id} was not reported alone`);
});

test('POSIX absolute home paths fail closed on macOS and Linux',()=>{
 assert.deepEqual(inspect('docs/note.md',macHome('alice',authPath)),['personal-home']);
 assert.deepEqual(inspect('docs/note.md',linuxHome('alice',authPath)),['personal-home']);
 // The drive-letter form reported before this change still reports.
 assert.deepEqual(inspect('docs/note.md',windowsHome('alice','.pi\\agent\\auth.json')),['personal-home']);
});

test('placeholders, tilde, $HOME and URL text stay publishable',()=>{
 const clean=[
  '/home/user/x',
  '/Users/user/x',
  '/home/example/x',
  '/Users/<name>/x',
  '/home/*/x',
  '/home/$USER/x',
  '/home/${USER}/x',
  '~/.pi/agent/auth.json',
  '$HOME/.ssh/id_ed25519',
  '${HOME}/.config/pi',
  'https://example.com/home/index.html',
  'docs/home/alice/config.json',
 ];
 for(const text of clean)assert.deepEqual(inspect('docs/note.md',text),[],`unexpected match: ${text}`);
});

test('the private-file rule still refuses live profile and state names',()=>{
 const refused=['auth.json','models.json','models-store.json','settings.json','trust.json','.pi/agent/mcp-auth.json','sessions/session.json','state/state.json','nested/backups/a.zip','.private/receipt.txt','.local/notes.md','logs/state/run.json'];
 for(const name of refused)assert.deepEqual(inspect(name,''),['private-file'],name);
 assert.deepEqual(inspect('docs/installation.md',''),[]);
 assert.deepEqual(inspect('examples/permission-config.json','{"piInfrastructureReadPaths":["~/.pi/agent"]}'),[]);
});

test('audit reports a planted leak by relative path and clears once the leak is removed',t=>{
 const root=fixture(t);
 place(root,'docs/note.md',`Authenticate in the private profile, never commit ${linuxHome('alice',authPath)}.\n`);
 place(root,'state/run.json','{}\n');
 const leaky=audit(root);
 assert.equal(leaky.passed,false);
 assert.equal(leaky.files,2);
 assert.equal(leaky.commits,0);
 assert.deepEqual(shape(leaky),[
  {file:'docs/note.md',rules:['personal-home']},
  {file:'state/run.json',rules:['private-file']},
 ]);
 assert.match(leaky.note,/not proof/);
 fs.rmSync(path.join(root,'docs/note.md'));
 fs.rmSync(path.join(root,'state/run.json'));
 const cleared=audit(root);
 assert.equal(cleared.passed,true);
 assert.deepEqual(cleared.failures,[]);
 assert.equal(cleared.files,0);
});

test('audit still refuses symlinks instead of following them',t=>{
 const root=fixture(t);
 place(root,'real/note.md','plain text\n');
 let linked=true;
 try{fs.symlinkSync(path.join(root,'real'),path.join(root,'linked'),process.platform==='win32'?'junction':'dir')}catch{linked=false}
 if(!linked){t.skip('this platform does not permit creating symlinks');return}
 const report=audit(root);
 assert.equal(report.passed,false);
 assert.deepEqual(report.failures,[{file:'linked',rules:['symlink']}]);
});