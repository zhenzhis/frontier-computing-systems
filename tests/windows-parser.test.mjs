import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const parser=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../managed/extensions/windows-policy/normalize-command.ps1');
test('Windows AST normalization changes command names, not quoted arguments',{skip:process.platform!=='win32'},()=>{
 const result=spawnSync(process.env.PWSH_PATH||'pwsh',['-NoProfile','-NonInteractive','-File',parser],{input:JSON.stringify({command:"remove-item -LiteralPath 'keep remove-item text'"}),encoding:'utf8',windowsHide:true});
 assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).command,"Remove-Item -LiteralPath 'keep remove-item text'");
});
test('invalid PowerShell is refused without execution',{skip:process.platform!=='win32'},()=>{
 const result=spawnSync(process.env.PWSH_PATH||'pwsh',['-NoProfile','-NonInteractive','-File',parser],{input:JSON.stringify({command:'Remove-Item "unfinished'}),encoding:'utf8',windowsHide:true});assert.notEqual(result.status,0);
});
