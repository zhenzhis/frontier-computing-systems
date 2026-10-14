import test from 'node:test';
import assert from 'node:assert/strict';
import {inspect} from '../scripts/audit-public.mjs';
test('publication audit finds secret-shaped content without returning its value',()=>{
 const secret=['sk','A'.repeat(32)].join('-');const result=inspect('example.md',secret);assert(result.includes('provider-key'));assert(!JSON.stringify(result).includes(secret));
});
test('publication audit refuses live profile files',()=>assert(inspect('auth.json','{}').includes('private-file')));
test('placeholder source examples remain publishable',()=>assert.deepEqual(inspect('examples/settings.example.json','{"apiKey":"<set-outside-repository>"}'),[]));
