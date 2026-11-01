import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const script=fileURLToPath(new URL('../scripts/verify-links.mjs',import.meta.url));

const run=root=>{
 const result=spawnSync(process.execPath,[script,'--root',root],{encoding:'utf8'});
 return {status:result.status,output:result.stdout.trim()?JSON.parse(result.stdout):null,stderr:result.stderr};
};
const fixture=t=>{
 const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'fcs-links-')));
 t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 return root;
};
const place=(root,relative,content)=>{
 const target=path.join(root,relative);
 fs.mkdirSync(path.dirname(target),{recursive:true});
 fs.writeFileSync(target,content);
};
// The CLI reports file names with path.relative, so the expected values must be
// native relative paths too: exact equality then holds on Windows (backslashes)
// as well as POSIX, without loosening the assertion.
const repoPath=(...parts)=>path.join(...parts);

test('fenced code is ignored at top level, indented and inside blockquotes, while unfenced text still fails',t=>{
 const root=fixture(t);
 place(root,'docs/fenced.md',[
  '# Fenced examples',
  '```',
  '[top](missing-top.md)',
  '```',
  '  ```',
  '  [indented](missing-indented.md)',
  '  ```',
  '> ```',
  '> [quoted](missing-quoted.md)',
  '> ```',
 ].join('\n'));
 let report=run(root);
 assert.equal(report.status,0,report.stderr);
 assert.deepEqual(Object.keys(report.output).sort(),['documents','failures','passed']);
 assert.equal(report.output.passed,true);
 assert.equal(report.output.documents,1);
 assert.deepEqual(report.output.failures,[]);
 place(root,'docs/fenced.md','[outside](missing-outside.md)\n');
 report=run(root);
 assert.equal(report.status,1);
 assert.equal(report.output.passed,false);
 assert.deepEqual(report.output.failures,[{file:repoPath('docs','fenced.md'),link:'missing-outside.md'}]);
});

test('link examples inside inline code are ignored while a real link in the same file fails',t=>{
 const root=fixture(t);
 place(root,'docs/inline.md',[
  'Use `[example](missing-example.md)` in prose.',
  'Also ``[sample](missing-multi.md)`` works.',
  'The real reference is [missing](missing-real.md).',
 ].join('\n'));
 const report=run(root);
 assert.equal(report.status,1,report.stderr);
 assert.equal(report.output.passed,false);
 assert.deepEqual(report.output.failures,[{file:repoPath('docs','inline.md'),link:'missing-real.md'}]);
});

test('external and mailto links are ignored, non-markdown fragments are not anchors, and bad fragments fail',t=>{
 const root=fixture(t);
 place(root,'docs/ignored.md',[
  '[web](https://example.com/missing)',
  '[insecure](http://example.com/missing)',
  '[mail](mailto:missing@example.com)',
 ].join('\n'));
 place(root,'docs/fragment.md',[
  '# Fragment',
  '[present](#fragment)',
  '[x](#missing)',
  '[non-markdown](../notes.txt#missing-section)',
 ].join('\n'));
 place(root,'notes.txt','[ignored](missing.txt)\n');
 const report=run(root);
 // The original assertion is intentionally reversed: a same-document fragment is
 // now validated instead of being skipped along with external links.
 assert.equal(report.status,1,report.stderr);
 assert.equal(report.output.passed,false);
 assert.equal(report.output.documents,2);
 assert.deepEqual(report.output.failures,[{file:repoPath('docs','fragment.md'),link:'#missing',reason:'missing-anchor'}]);
});

test('cross-document fragments are checked after the target markdown file exists',t=>{
 const root=fixture(t);
 place(root,'docs/target.md',[
  '# Target heading',
  '## Existing section',
 ].join('\n'));
 place(root,'docs/ok.md',[
  '[section](target.md#existing-section)',
  '[heading](target.md#target-heading)',
 ].join('\n'));
 place(root,'docs/bad.md',[
  '[missing-section](target.md#missing-section)',
  '[missing-file](gone.md#missing-section)',
 ].join('\n'));
 const report=run(root);
 assert.equal(report.status,1,report.stderr);
 assert.equal(report.output.passed,false);
 assert.equal(report.output.documents,3);
 assert.deepEqual(report.output.failures,[
  {file:repoPath('docs','bad.md'),link:'target.md#missing-section',reason:'missing-anchor'},
  {file:repoPath('docs','bad.md'),link:'gone.md#missing-section'},
 ]);
});

test('heading slugs lowercase, strip punctuation and emphasis, keep code/link text and CJK, and deduplicate',t=>{
 const root=fixture(t);
 place(root,'docs/slugs.md',[
  '# Hello, World!',
  '## Use `npm run verify` and [the docs](https://example.com/docs)',
  '## Emphasis *strong* and **bold**',
  '## CJK 标题',
  '## Repeated',
  '## Repeated',
  '## Repeated',
  '[punctuation](#hello-world)',
  '[code-and-link](#use-npm-run-verify-and-the-docs)',
  '[emphasis](#emphasis-strong-and-bold)',
  '[cjk](#cjk-标题)',
  '[encoded-cjk](#cjk-%E6%A0%87%E9%A2%98)',
  '[first](#repeated)',
  '[second](#repeated-1)',
  '[third](#repeated-2)',
 ].join('\n'));
 const report=run(root);
 assert.equal(report.status,0,report.stderr);
 assert.equal(report.output.passed,true);
 assert.equal(report.output.documents,1);
 assert.deepEqual(report.output.failures,[]);
});

test('explicit id and a-name anchors resolve fragments in the same and another document',t=>{
 const root=fixture(t);
 place(root,'docs/explicit.md',[
  '<h2 id="custom-anchor">Custom</h2>',
  '<a name="legacy-anchor"></a>',
  '[custom](#custom-anchor)',
  '[legacy](#legacy-anchor)',
 ].join('\n'));
 place(root,'docs/link.md',[
  '[custom](explicit.md#custom-anchor)',
  '[missing](explicit.md#missing-anchor)',
 ].join('\n'));
 const report=run(root);
 assert.equal(report.status,1,report.stderr);
 assert.equal(report.output.passed,false);
 assert.equal(report.output.documents,2);
 assert.deepEqual(report.output.failures,[{file:repoPath('docs','link.md'),link:'explicit.md#missing-anchor',reason:'missing-anchor'}]);
});

test('a missing relative link is reported with its file and raw link and exits 1',t=>{
 const root=fixture(t);
 place(root,'target.md','# Target\n');
 place(root,'docs/present.md','[target](../target.md)\n');
 place(root,'docs/missing.md','[missing](../missing.md)\n');
 const report=run(root);
 assert.equal(report.status,1,report.stderr);
 assert.equal(report.output.passed,false);
 assert.equal(report.output.documents,3);
 assert.deepEqual(report.output.failures,[{file:repoPath('docs','missing.md'),link:'../missing.md'}]);
});

test('a malformed percent escape is a structured failure with a stable reason instead of a crash',t=>{
 const root=fixture(t);
 place(root,'docs/bad.md','[broken](bad%zz.md)\n');
 const report=run(root);
 assert.equal(report.status,1);
 assert.equal(report.output.passed,false);
 assert.deepEqual(report.output.failures,[{file:repoPath('docs','bad.md'),link:'bad%zz.md',reason:'undecodable-link'}]);
 assert.doesNotMatch(report.stderr,/URIError/);
 assert.doesNotMatch(report.stderr,/\n\s+at /);
});

test('an undecodable link does not stop the rest of the document from being checked',t=>{
 const root=fixture(t);
 place(root,'docs/mixed.md',[
  '[broken](bad%zz.md)',
  '[missing](missing-good.md)',
  '[present](present.md)',
 ].join('\n'));
 place(root,'docs/present.md','# Present\n');
 const report=run(root);
 assert.equal(report.status,1);
 assert.equal(report.output.passed,false);
 assert.deepEqual(report.output.failures,[
  {file:repoPath('docs','mixed.md'),link:'bad%zz.md',reason:'undecodable-link'},
  {file:repoPath('docs','mixed.md'),link:'missing-good.md'},
 ]);
});