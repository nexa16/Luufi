import { readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
const root=process.cwd();
const policies=JSON.parse(readFileSync('lib/mcp/policies.json','utf8'));
for(const [id,policy] of Object.entries(policies)) {
  assert.equal(readFileSync(`docs/guidelines/${id}.md`,'utf8'),policy.content,`Richtlinienquelle ${id}`);
  assert.match(policy.content,new RegExp(`version: ${policy.version.replaceAll('.','\\.')}`));
}
for(const filename of readdirSync('docs/features').filter(name=>name.endsWith('.md')&&name!=='README.md')) {
  const text=readFileSync(path.join('docs/features',filename),'utf8');
  assert.match(text,/feature: [a-z0-9-]+/); assert.match(text,/documentation_policy: 1\.0\.0/);
  for(const heading of ['Zweck und Umfang','Nutzerabläufe','Regeln und Zustände','Sonder- und Fehlerfälle','Grenzen','Technische Verweise','Verifikation'])
    assert.ok(text.includes(`## ${heading}`),`${filename}: ${heading}`);
}
for(const file of ['README.md','docs/features/README.md','docs/guidelines/README.md']) {
  for(const match of readFileSync(file,'utf8').matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)) {
    if(!/^[a-z]+:/.test(match[1])) readFileSync(path.resolve(root,path.dirname(file),match[1]));
  }
}
console.log('Dokumentationsstruktur, Einstiegslinks und exakte Richtlinienquellen geprüft.');
