import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { sqlStatements } from '../apps/api/dist/store/sql-statements.js';
import { MysqlStore } from '../apps/api/dist/store/mysql-store.js';

assert.deepEqual(sqlStatements("SELECT 'a;b--c/*d*/'; -- ignored;\n SELECT `semi;colon`; /* ignored; */ SELECT 'it''s;ok';"), ["SELECT 'a;b--c/*d*/'", 'SELECT `semi;colon`', "SELECT 'it''s;ok'"]);
assert.deepEqual(sqlStatements(String.raw`SELECT 'it\'s;ok'; SELECT 2;`), [String.raw`SELECT 'it\'s;ok'`, 'SELECT 2']);
assert.throws(()=>sqlStatements("SELECT 'unterminated"));
assert.throws(()=>sqlStatements('/* unterminated'));
const raw=await readFile(new URL('../apps/api/src/store/schema.mysql.sql',import.meta.url),'utf8');
const statements=sqlStatements(raw);
const insert=statements.find(s=>s.startsWith('INSERT IGNORE INTO accuracy_class'));
assert(insert?.endsWith("('PX',0,0,'Special protection specification; confirm applicable standard')"));
assert.equal(statements.filter(s=>s.includes('confirm applicable standard')).length,1);
assert(!statements.some(s=>s.startsWith('confirm applicable')));
// Exercise the actual initializer with a recording pool. This verifies dispatch,
// not SQL server compatibility; it needs no credentials or production database.
const store=new MysqlStore('mysql://localhost/regression?ssl=0');
await store.close();
const executed=[];
store.pool={execute:async sql=>{
 executed.push(sql);
 if(sql.startsWith('CREATE INDEX') || sql.startsWith('CREATE UNIQUE INDEX')) throw {code:'ER_DUP_KEYNAME'};
 if(sql.startsWith('ALTER TABLE')) throw {code:'ER_DUP_FIELDNAME'};
 return [[{n:1}],[]];
}};
await store.init();
assert(executed.includes(insert));
assert.equal(executed.length,statements.length+1);
store.pool={execute:async()=>{throw {code:'ER_PARSE_ERROR'};}};
await assert.rejects(()=>store.init(),/MySQL migration statement 1 failed \(ER_PARSE_ERROR\)/);
console.log('MySQL migration splitting, repeat initialization and error-context regression checks passed.');
