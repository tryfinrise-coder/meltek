import { cp, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, basename } from 'node:path';
import { spawn } from 'node:child_process';
const destination = await mkdtemp(join(tmpdir(), 'meltek-production-build-'));
for (const name of ['package.json','package-lock.json','apps','packages']) {
  await cp(name, join(destination,name), { recursive:true, filter: source => !['node_modules','dist','data'].includes(basename(source)) && !source.endsWith('.tsbuildinfo') });
}
async function run(command) {
  await new Promise((resolve,reject) => {
    const child = process.platform === 'win32'
      ? spawn('cmd.exe',['/d','/s','/c',command],{cwd:destination,stdio:'inherit',windowsHide:true})
      : spawn('/bin/sh',['-c',command],{cwd:destination,stdio:'inherit'});
    child.on('error',reject); child.on('exit',code=>code===0?resolve():reject(new Error(`${command} failed with ${code}`)));
  });
}
await run('npm ci --omit=dev --ignore-scripts');
await run('npm run build');
console.log(`Production-only clean install and build passed: ${destination}`);
