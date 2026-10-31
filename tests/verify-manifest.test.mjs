import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/verify-manifest.mjs',import.meta.url));
const sha=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');

const run=(root,extra=[])=>{
 const result=spawnSync(process.execPath,[script,'--root',root,...extra],{encoding:'utf8'});
 return {status:result.status,output:result.stdout.trim()?JSON.parse(result.stdout):null,stderr:result.stderr};
};
const place=(root,relative,content)=>{
 const target=path.join(root,relative);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,content);
};
// The fixture mirrors the repository layout: `package.json` carries the version
// and is itself a release input, while `release-manifest.json` and
// `validation.local.json` are the only excluded files. Everything else in the
// fixture must be registered, so `package.json` is expected in every manifest.
const fixture=t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'fcs-manifest-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 fs.writeFileSync(path.join(root,'package.json'),JSON.stringify({name:'manifest-fixture',version:'0.0.1',private:true},null,2)+'\n');
 fs.writeFileSync(path.join(root,'alpha.txt'),'alpha\n');
 fs.writeFileSync(path.join(root,'beta.txt'),'beta\n');
 return root;
};
const manifest=(root,files,version='0.0.1')=>{
 fs.writeFileSync(path.join(root,'release-manifest.json'),JSON.stringify({schemaVersion:1,version,baseWorkflow:'WF7',intentRouting:'deferred',files:files.map(p=>({path:p,sha256:sha(path.join(root,p))}))},null,2)+'\n');
};

test('an unregistered source file is rejected and accepted once the manifest lists it',t=>{
 const root=fixture(t);
 manifest(root,['alpha.txt']);
 const failed=run(root);
 assert.equal(failed.status,1,failed.stderr);
 assert.equal(failed.output.passed,false);
 assert.equal(failed.output.checkedFiles,1);
 assert.deepEqual(failed.output.failures,[]);
 assert.deepEqual(failed.output.unlisted,['beta.txt','package.json']);
 manifest(root,['alpha.txt','beta.txt','package.json']);
 const passed=run(root);
 assert.equal(passed.status,0,passed.stderr);
 assert.equal(passed.output.passed,true);
 assert.equal(passed.output.checkedFiles,3);
 assert.deepEqual(passed.output.failures,[]);
 assert.deepEqual(passed.output.unlisted,[]);
 place(root,'nested/deep.txt','deep\n');
 const nested=run(root);
 assert.equal(nested.status,1);
 assert.equal(nested.output.passed,false);
 assert.deepEqual(nested.output.failures,[]);
 assert.deepEqual(nested.output.unlisted,['nested/deep.txt']);
});

test('hash drift, removed registered files and package version mismatches still fail',t=>{
 const root=fixture(t);
 manifest(root,['alpha.txt','beta.txt','package.json']);
 fs.writeFileSync(path.join(root,'alpha.txt'),'tampered\n');
 const drift=run(root);
 assert.equal(drift.status,1);
 assert.equal(drift.output.passed,false);
 assert.deepEqual(drift.output.failures,['alpha.txt']);
 assert.deepEqual(drift.output.unlisted,[]);
 fs.rmSync(path.join(root,'beta.txt'));
 const removed=run(root);
 assert.equal(removed.status,1);
 assert.equal(removed.output.passed,false);
 assert.deepEqual(removed.output.failures,['alpha.txt','beta.txt']);
 assert.deepEqual(removed.output.unlisted,[]);
 manifest(root,['alpha.txt'],'9.9.9');
 const mismatch=run(root);
 assert.equal(mismatch.status,1);
 assert.equal(mismatch.output.passed,false);
 assert.deepEqual(mismatch.output.failures,['package-version']);
 assert.deepEqual(mismatch.output.unlisted,['package.json']);
});

test('--write and verification share one exclusion set, and later source files are still caught',t=>{
 const root=fixture(t);
 for(const relative of ['.git/config','node_modules/pkg/index.js','.local/local.txt','.private/private.txt','.workflow/state.txt','state/state.json','sessions/session.txt','backups/backup.zip','coverage/lcov.info','validation.local.json'])place(root,relative,'ignored\n');
 const written=run(root,['--write']);
 assert.equal(written.status,0,written.stderr);
 assert.deepEqual(written.output,{written:true,files:3});
 const saved=JSON.parse(fs.readFileSync(path.join(root,'release-manifest.json'),'utf8'));
 assert.equal(saved.version,'0.0.1');
 assert.deepEqual(saved.files.map(e=>e.path),['alpha.txt','beta.txt','package.json']);
 assert.ok(saved.files.every(e=>e.sha256===sha(path.join(root,e.path))));
 const verified=run(root);
 assert.equal(verified.status,0,verified.stderr);
 assert.equal(verified.output.passed,true);
 assert.equal(verified.output.checkedFiles,3);
 assert.deepEqual(verified.output.failures,[]);
 assert.deepEqual(verified.output.unlisted,[]);
 place(root,'gamma.txt','gamma\n');
 const stale=run(root);
 assert.equal(stale.status,1);
 assert.equal(stale.output.passed,false);
 assert.deepEqual(stale.output.failures,[]);
 assert.deepEqual(stale.output.unlisted,['gamma.txt']);
});
