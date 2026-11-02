import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {workerPolicy} from './worker-policy.mjs';
import {pathIdentity,samePath,isStrictDescendant} from './path-scope.mjs';

const caseInsensitiveFileSystem = (() => {
  const probe = fs.mkdtempSync(path.join(os.tmpdir(), 'fcs-case-probe-'));
  try {
    fs.mkdirSync(path.join(probe, 'probe'));
    return fs.existsSync(path.join(probe, 'PROBE'));
  } finally {
    fs.rmSync(probe, {recursive: true, force: true});
  }
})();

function projectFixture() {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'fcs-worker-policy-')));
  fs.mkdirSync(path.join(root, 'src'), {recursive: true});
  fs.writeFileSync(path.join(root, 'src', 'foo.mjs'), 'declared');
  return root;
}

const task = {stage: 'implement', authority: {actions: ['read', 'write']}, baseline: {'src/foo.mjs': 'declared'}};

// Simulate the worker tool pipeline: only a non-blocked write reaches disk.
function attempt(project, toolName, target) {
  const verdict = workerPolicy(project, task).guard({toolName, input: {path: target}}) ?? {};
  if (!verdict.block && toolName !== 'read') {
    const file = path.resolve(project, target);
    fs.mkdirSync(path.dirname(file), {recursive: true});
    fs.writeFileSync(file, 'written');
  }
  return verdict;
}

test('path identity is case-insensitive on win32 and exact on posix, independent of host', () => {
  assert.equal(pathIdentity('/project/src/foo.mjs', 'posix'), '/project/src/foo.mjs');
  assert.equal(pathIdentity('C:\\Project\\Src\\Foo.mjs', 'win32'), 'c:\\project\\src\\foo.mjs');
  assert.equal(pathIdentity('c:/project/SRC/FOO.mjs/', 'win32'), 'c:\\project\\src\\foo.mjs');
  assert.equal(samePath('/project/src/foo.mjs', '/project/src/FOO.mjs', 'posix'), false);
  assert.equal(samePath('C:\\Project\\src\\foo.mjs', 'c:/project/SRC/FOO.mjs', 'win32'), true);
});

test('strict descendant compares per platform and never treats the root itself as inside', () => {
  assert.equal(isStrictDescendant('/root/work', '/root/work/candidate', 'posix'), true);
  assert.equal(isStrictDescendant('/root/work', '/root/WORK/candidate', 'posix'), false);
  assert.equal(isStrictDescendant('/root/work', '/root/work/../work/candidate', 'posix'), true);
  assert.equal(isStrictDescendant('/root/work', '/root/work', 'posix'), false);
  assert.equal(isStrictDescendant('/root/work', '/root/work/', 'posix'), false);
  assert.equal(isStrictDescendant('/', '/root/work', 'posix'), true);
  assert.equal(isStrictDescendant('/', '/', 'posix'), false);
  assert.equal(isStrictDescendant('C:\\Root\\Work', 'c:/ROOT/WORK/Candidate', 'win32'), true);
  assert.equal(isStrictDescendant('C:\\Root\\Work', 'C:\\Root\\Work', 'win32'), false);
  assert.equal(isStrictDescendant('C:\\', 'C:\\Temp', 'win32'), true);
  assert.equal(isStrictDescendant('C:\\', 'c:/', 'win32'), false);
});

test('posix: a case variant of the assigned file is refused, not created, and keeps the fixed reason', {skip: caseInsensitiveFileSystem}, () => {
  const project = projectFixture();
  try {
    for (const target of ['src/FOO.mjs', 'SRC/foo.mjs']) {
      const verdict = attempt(project, 'write', target);
      assert.equal(verdict.block, true);
      assert.equal(verdict.reason, 'Worker write outside exact assigned files refused');
      assert.equal(fs.existsSync(path.resolve(project, target)), false, `${target} must not be created`);
    }
    assert.equal(attempt(project, 'write', 'src/foo.mjs').block, undefined);
    assert.equal(attempt(project, 'write', 'src/other.mjs').block, true);
    assert.equal(attempt(project, 'read', 'src/FOO.mjs').block, undefined);
  } finally {
    fs.rmSync(project, {recursive: true, force: true});
  }
});
