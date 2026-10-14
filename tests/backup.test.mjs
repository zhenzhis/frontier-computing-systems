import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {backup} from '../scripts/backup.mjs';

test('all source revisions and tags recover from a verified bundle; preview writes nothing',()=>{
 const tmp=fs.mkdtempSync(path.join(os.tmpdir(),'zhenzhi-backup-')),repo=path.join(tmp,'source'),destination=path.join(tmp,'backup');
 fs.mkdirSync(repo);
 const git=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
 git(repo,'init','-b','main');git(repo,'config','user.name','Backup Test');git(repo,'config','user.email','backup-test@example.invalid');
 fs.writeFileSync(path.join(repo,'.gitattributes'),'*.md text eol=lf\n');
 fs.writeFileSync(path.join(repo,'README.md'),'first revision\n');git(repo,'add','.');git(repo,'commit','-m','first');const first=git(repo,'rev-parse','HEAD');git(repo,'tag','v0.0.1');
 fs.writeFileSync(path.join(repo,'README.md'),'second revision\n');git(repo,'commit','-am','second');const second=git(repo,'rev-parse','HEAD');
 const preview=backup(repo,destination);assert.equal(preview.commits,2);assert(!fs.existsSync(destination));
 const saved=backup(repo,destination,{apply:true});assert(saved.bundleVerified);assert.equal(saved.versions.length,2);
 for(const artifact of saved.artifacts)assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(saved.folder,artifact.file))).digest('hex'),artifact.sha256);
 const restored=path.join(tmp,'restored');git(tmp,'clone',path.join(saved.folder,'history.bundle'),restored);
 assert.equal(git(restored,'rev-parse','HEAD'),second);assert.equal(git(restored,'rev-parse','v0.0.1'),first);assert.equal(fs.readFileSync(path.join(restored,'README.md'),'utf8'),'second revision\n');
 fs.writeFileSync(path.join(repo,'README.md'),'uncommitted work\n');assert.throws(()=>backup(repo,destination),/dirty work/);
});
