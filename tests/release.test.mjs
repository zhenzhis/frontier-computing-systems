import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {releaseTestFiles,releasePlan,release} from '../scripts/release.mjs';

const root=fileURLToPath(new URL('..',import.meta.url)),script=fileURLToPath(new URL('../scripts/release.mjs',import.meta.url));
const fixture=t=>{const directory=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'fcs-release-')));t.after(()=>fs.rmSync(directory,{recursive:true,force:true}));return directory;};
const place=(directory,relative,content='placeholder\n')=>{const target=path.join(directory,relative);fs.mkdirSync(path.dirname(target),{recursive:true});fs.writeFileSync(target,content);};
const manifest=(directory,scripts,version='0.0.1')=>fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({name:'release-fixture',version,private:true,scripts},null,2)+'\n');
// git and gh are absent from this PATH, so a preview that reached for either
// would fail loudly instead of quietly mutating a repository.
const isolated=directory=>{const empty=path.join(directory,'empty-path');fs.mkdirSync(empty);const env={...process.env};for(const key of Object.keys(env))if(key.toLowerCase()==='path')delete env[key];env.PATH=empty;return env;};
const gitAt=(cwd,...args)=>execFileSync('git',args,{cwd,encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
function releaseRepository(t,{remote=false}={}){
 const base=fixture(t),project=path.join(base,'project');fs.mkdirSync(project);
 const git=(...args)=>gitAt(project,...args);
 git('init','-b','main');git('config','user.name','Fixture');git('config','user.email','fixture@example.invalid');
 fs.writeFileSync(path.join(project,'package.json'),JSON.stringify({name:'release-fixture',version:'9.9.9',private:true},null,2)+'\n');
 const scripts=path.join(project,'scripts');fs.mkdirSync(scripts);
 for(const name of ['release.mjs','backup.mjs','audit-public.mjs'])fs.copyFileSync(path.join(root,'scripts',name),path.join(scripts,name));
 git('add','.');git('commit','-m','baseline');
 let bare=null;
 if(remote){bare=path.join(base,'remote.git');execFileSync('git',['init','--bare',bare],{stdio:['ignore','pipe','pipe']});git('remote','add','origin',bare);git('push','-u','origin','main');}
 return{base,project,git,remote:bare};
}
function fakeGh(base,{runs=[],status=0}={}){
 const bin=path.join(base,'fake-bin');fs.mkdirSync(bin,{recursive:true});const scriptFile=path.join(bin,'gh.mjs');
 fs.writeFileSync(scriptFile,`process.stdout.write(${JSON.stringify(JSON.stringify(runs))}+'\\n');process.exitCode=${status};\n`);
 if(process.platform==='win32')fs.writeFileSync(path.join(bin,'gh.cmd'),`@"${process.execPath}" "${scriptFile}" %*\r\n`);
 else{const file=path.join(bin,'gh');fs.writeFileSync(file,`#!/bin/sh\nexec "${process.execPath}" "${scriptFile}" "$@"\n`);fs.chmodSync(file,0o755)}
 const env={...process.env},pathKey=Object.keys(env).find(key=>key.toLowerCase()==='path')??'PATH';env[pathKey]=[bin,env[pathKey]].filter(Boolean).join(path.delimiter);return env;
}
const runRelease=(project,args,env={})=>spawnSync(process.execPath,[path.join(project,'scripts','release.mjs'),...args],{cwd:project,encoding:'utf8',env:{...process.env,...env}});
function machineFailure(result){
 assert.equal(result.status,1,result.stderr);
 assert.equal(result.stdout.trim(),'');
 const lines=result.stderr.trim().split(/\r?\n/);assert.equal(lines.length,1,'a refusal emits exactly one machine-readable line');
 const failure=JSON.parse(lines[0]);assert.deepEqual(Object.keys(failure).sort(),['message','stage']);return failure;
}
function releaseFailure(run){
 let error;try{run()}catch(failure){error=failure}assert(error,'the release call must refuse');return error;
}

test('the release gate derives exactly the npm test set, including the previously skipped suites',()=>{
 const enumerated=['runtime','tests'].flatMap(directory=>fs.readdirSync(path.join(root,directory)).filter(name=>name.endsWith('.test.mjs')).map(name=>`${directory}/${name}`)).sort();
 const derived=releaseTestFiles(root);
 assert.deepEqual(derived,enumerated,'the release gate must execute the same files as npm test');
 assert.equal(new Set(derived).size,derived.length,'no test file may be executed twice');
 for(const file of ['runtime/autopilot.test.mjs','runtime/dsh-executor.test.mjs','runtime/superagent.test.mjs'])assert.ok(derived.includes(file),`the release gate must run ${file}`);
 assert.ok(derived.includes('tests/release.test.mjs'));
 const source=fs.readFileSync(script,'utf8');
 assert.match(source,/releaseTestFiles\(root\)/,'--apply must run the derived set');
 assert.ok(!/['"`](?:runtime|tests)\//.test(source),'the release gate must not hard-code test file names');
});

test('releaseTestFiles expands the supported globs of a fixture package.json',t=>{
 const directory=fixture(t);
 manifest(directory,{test:'node --test runtime/*.test.mjs tests/*.test.mjs'});
 place(directory,'runtime/alpha.test.mjs');place(directory,'runtime/notes.md');place(directory,'tests/beta.test.mjs');place(directory,'tests/nested/gamma.test.mjs');place(directory,'tests/helper.mjs');
 assert.deepEqual(releaseTestFiles(directory),['runtime/alpha.test.mjs','tests/beta.test.mjs']);
 assert.equal(releasePlan(directory).tag,'v0.0.1');
});

test('releaseTestFiles fails closed on any test script shape it does not understand',t=>{
 const directory=fixture(t);
 place(directory,'runtime/alpha.test.mjs');place(directory,'tests/beta.test.mjs');place(directory,'tools/gamma.test.mjs');fs.mkdirSync(path.join(directory,'empty'));
 const refuses=script=>{manifest(directory,{test:script});assert.throws(()=>releaseTestFiles(directory),error=>/Unrecognised|does not|matches no test file|declared twice/.test(error.message),`scripts.test must be refused: ${script}`);};
 refuses('node --test runtime/*.test.mjs tests/*.test.mjs tools/*.test.mjs');
 refuses('node --test runtime/*.test.mjs tests/*.test.mjs tests/release.test.mjs');
 refuses('node --test runtime/**/*.test.mjs tests/*.test.mjs');
 refuses('node --test runtime/*.test.mjs empty/*.test.mjs');
 refuses('node --test runtime/*.test.mjs runtime/*.test.mjs');
 refuses('node --test');
 refuses('jest');
 manifest(directory,{});assert.throws(()=>releaseTestFiles(directory),/no scripts\.test/);
 assert.throws(()=>releaseTestFiles(path.join(directory,'missing')),/package\.json/);
 manifest(directory,{test:'node --test runtime/*.test.mjs tests/*.test.mjs'});
 assert.deepEqual(releaseTestFiles(directory),['runtime/alpha.test.mjs','tests/beta.test.mjs']);
});

test('preview prints the plan and mutates nothing: no import side effect, no backup, no tag',t=>{
 const directory=fixture(t),env=isolated(directory),destination=path.join(directory,'backup');
 // A checkout that is not a git repository (the supervisor's frozen copy) has no
 // tags to compare, and this test must not depend on git being installed.
 const tags=()=>{if(!fs.existsSync(path.join(root,'.git')))return null;try{return execFileSync('git',['tag','--list'],{cwd:root,encoding:'utf8'}).trim();}catch{return null;}};
 const before=tags(),preview=spawnSync(process.execPath,[script,'--backup-dir',destination],{cwd:directory,encoding:'utf8',env});
 assert.equal(preview.status,0,preview.stderr);
 assert.equal(preview.stderr,'');
 const plan=JSON.parse(preview.stdout),version=JSON.parse(fs.readFileSync(path.join(root,'package.json'),'utf8')).version;
 assert.deepEqual(Object.keys(plan).sort(),['apply','backupDestination','push','requiresSuccessfulRemoteCIForPush','steps','tag']);
 assert.equal(plan.apply,false);assert.equal(plan.push,false);assert.equal(plan.requiresSuccessfulRemoteCIForPush,true);
 assert.equal(plan.tag,`v${version}`);assert.equal(plan.backupDestination,destination);
 assert.equal(fs.existsSync(destination),false,'preview must write no backup');
 assert.deepEqual(fs.readdirSync(directory),['empty-path'],'preview must write nothing at all');
 if(before!==null)assert.equal(tags(),before,'preview must create no tag');
 const imported=spawnSync(process.execPath,['--input-type=module','-e',`await import(${JSON.stringify(pathToFileURL(script).href)})`],{cwd:directory,encoding:'utf8',env});
 assert.equal(imported.status,0,imported.stderr);
 assert.equal(imported.stdout,'','importing the module must not execute the gate');
 assert.equal(imported.stderr,'');
 assert.deepEqual(fs.readdirSync(directory),['empty-path']);
});

test('the plan refuses a version its tag cannot express and keeps the push guard',t=>{
 const directory=fixture(t);
 manifest(directory,{test:'node --test runtime/*.test.mjs tests/*.test.mjs'});
 place(directory,'runtime/alpha.test.mjs');place(directory,'tests/beta.test.mjs');
 assert.equal(releasePlan(directory,{push:true}).requiresSuccessfulRemoteCIForPush,true);
 assert.equal(releasePlan(directory,{push:true}).push,true);
 fs.writeFileSync(path.join(directory,'package.json'),JSON.stringify({version:'0.1'},null,2));
 assert.throws(()=>releasePlan(directory),/semver/);
});

// Baseline a6a52657bce8fe36f52e9d8d4d568b18c37b69e6 printed only the folded
// error.message and exited 1; it had no stage record. The assertions below are
// the observable contrast this change introduces.
test('the release CLI names a dirty candidate without tags, backups or pushes',t=>{
 const{project,git}=releaseRepository(t,{remote:true}),destination=path.join(path.dirname(project),'backups');
 fs.appendFileSync(path.join(project,'package.json'),'\n');
 const tags=git('tag','--list'),remote=git('ls-remote','origin');
 const failure=machineFailure(runRelease(project,['--apply','--backup-dir',destination]));
 assert.equal(failure.stage,'dirty-tree');
 assert.equal(failure.message,'Release candidate is dirty');
 assert.equal(git('tag','--list'),tags,'a dirty refusal creates no tag');
 assert.equal(git('ls-remote','origin'),remote,'a dirty refusal pushes nothing');
 assert.equal(fs.existsSync(destination),false,'a dirty refusal writes no backup');
});

test('the release CLI names an existing tag and never overwrites or pushes it',t=>{
 const{project,git}=releaseRepository(t,{remote:true}),destination=path.join(path.dirname(project),'backups');
 git('tag','-a','v9.9.9','-m','fixture');
 const tags=git('tag','--list'),remote=git('ls-remote','origin');
 const failure=machineFailure(runRelease(project,['--apply','--backup-dir',destination]));
 assert.equal(failure.stage,'tag-exists');
 assert.equal(failure.message,'Release tag already exists; never overwrite');
 assert.equal(git('tag','--list'),tags,'an existing-tag refusal leaves tags unchanged');
 assert.equal(git('ls-remote','origin'),remote,'an existing-tag refusal pushes nothing');
 assert.equal(fs.existsSync(destination),false,'an existing-tag refusal writes no backup');
});

test('the release CLI distinguishes a remote main mismatch before any tag or push',t=>{
 const{project,git}=releaseRepository(t,{remote:true}),destination=path.join(path.dirname(project),'backups');
 fs.writeFileSync(path.join(project,'local.txt'),'ahead\n');git('add','.');git('commit','-m','local ahead');
 const tags=git('tag','--list'),remote=git('ls-remote','origin');
 const failure=machineFailure(runRelease(project,['--apply','--push','--backup-dir',destination]));
 assert.equal(failure.stage,'remote-main-mismatch');
 assert.equal(failure.message,'Push the candidate to main, back it up and wait for its CI before publishing the tag');
 assert.equal(git('tag','--list'),tags);
 assert.equal(git('ls-remote','origin'),remote);
 assert.equal(fs.existsSync(destination),false);
});

test('the release gate distinguishes missing exact-commit Verify success and a failed query',t=>{
 const{project,git}=releaseRepository(t,{remote:true}),destination=path.join(path.dirname(project),'backups');
 const tags=git('tag','--list'),remote=git('ls-remote','origin');
 const notPassed=releaseFailure(()=>release(project,{apply:true,push:true,backupDestination:destination,runGh:()=>'[]'}));
 assert.equal(notPassed.releaseStage,'remote-ci-not-passed');
 assert.equal(notPassed.message,'Latest remote Verify run for this exact candidate must pass before tag publication');
 const queryFailed=releaseFailure(()=>release(project,{apply:true,push:true,backupDestination:destination,runGh:()=>{throw Error('gh unavailable')}}));
 assert.equal(queryFailed.releaseStage,'ci-query');
 assert.equal(queryFailed.message,'Cannot query the remote Verify run for this candidate');
 assert.equal(git('tag','--list'),tags,'a CI refusal creates no tag');
 assert.equal(git('ls-remote','origin'),remote,'a CI refusal pushes nothing');
 assert.equal(fs.existsSync(destination),false,'a CI refusal writes no backup');
});
