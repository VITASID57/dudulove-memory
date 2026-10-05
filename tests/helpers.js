const { spawn } = require('node:child_process');
const { mkdtemp, rm } = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
async function start(dataDir) {
  const child = spawn(process.execPath, ['server.js'], { cwd: path.resolve(__dirname, '..'),
    env: { ...process.env, MEMORY_DATA_DIR: dataDir, MEMORY_ADMIN_TOKEN: '', MEMORY_ALLOWED_ORIGINS: '', HOST: '127.0.0.1', PORT: '0' }, stdio: ['ignore','pipe','pipe'], windowsHide: true });
  let output = '';
  const base = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => { child.kill(); reject(new Error('Test server startup timed out')); }, 10000);
    child.once('exit', () => { clearTimeout(timer); reject(new Error('Test server exited: '+output)); });
    child.stderr.on('data', data => output += data);
    child.stdout.on('data', data => { const url=String(data).match(/http:\/\/127\.0\.0\.1:\d+/); if(url){clearTimeout(timer);resolve(url[0]);} });
  });
  const stop = () => new Promise(resolve => { if(child.exitCode!==null)return resolve();child.once('exit',resolve);child.kill(); });
  return { base, stop };
}
async function fixture() {
  const dir=await mkdtemp(path.join(os.tmpdir(),'dudulove-memory-test-'));
  let server=await start(dir);
  return { dir, get base(){return server.base;}, async restart(){await server.stop();server=await start(dir);},
    async close(){await server.stop();if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('dudulove-memory-test-'))await rm(dir,{recursive:true,force:true});} };
}
async function call(base,path,token,body,method) {
  const response=await fetch(base+path,{method:method||(body===undefined?'GET':'POST'),
    headers:{'Content-Type':'application/json',...(token?{Authorization:`Bearer ${token}`}:{})},...(body===undefined?{}:{body:JSON.stringify(body)})});
  return { status:response.status,data:await response.json() };
}
module.exports={fixture,call,start};
