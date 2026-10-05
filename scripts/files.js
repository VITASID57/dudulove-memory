const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const entries = ['.env.example','.gitignore','.gitattributes','AGENTS.md','LICENSE','README.md','THIRD_PARTY.md','CONTRIBUTING.md','SECURITY.md',
  'app.js','server.js','mcp-stdio.js','package.json','package-lock.json','memory-core','storage','services','routes',
  'connectors','platform','public','docs','examples','scripts','tests','.github'];
function files() {
  const result=[];
  function visit(name) {
    const full=path.join(root,name), stat=fs.lstatSync(full);
    if(stat.isSymbolicLink())throw new Error(`Release cannot contain symlink: ${name}`);
    if(stat.isDirectory())for(const child of fs.readdirSync(full).sort())visit(`${name}/${child}`);
    else result.push(name);
  }
  entries.forEach(visit);return result;
}
module.exports={root,files};
