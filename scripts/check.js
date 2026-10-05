const fs=require('node:fs'),path=require('node:path'),{spawnSync}=require('node:child_process');
const {root,files}=require('./files');
const names=files(),problems=[],graph=new Map();
const secret=/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----|\bgh[pousr]_[a-zA-Z0-9]{30,}|\bsk-[a-zA-Z0-9_-]{30,}/;
const privatePath=/[A-Z]:[\\/](?:Users|memory-server|commercial-product)[\\/]/i;
const forbidden=/\.(?:db|log|pem|key|sqlite|sqlite3)$|(?:^|\/)(?:data|node_modules|\.git|\.playwright-cli)\//;
const allowed={ 'memory-core':['memory-core'],storage:['storage','memory-core'],services:['services','memory-core'],
  routes:['routes','services','memory-core'],connectors:['connectors','services','memory-core'],platform:['platform','memory-core'],public:['public'] };
for(const name of names){
  const full=path.join(root,name),text=fs.readFileSync(full,'utf8');
  if(text.includes('\0'))problems.push(`Binary character in source: ${name}`);
  if(forbidden.test(name)||(name.startsWith('.env')&&name!=='.env.example'))problems.push(`Forbidden release file: ${name}`);
  if(secret.test(text)||privatePath.test(text))problems.push(`Sensitive pattern: ${name}`);
  if(name.endsWith('.md'))for(const link of text.matchAll(/\]\(([^)#]+)(?:#[^)]*)?\)/g)){
    if(/^(https?:|mailto:|#)/.test(link[1]))continue;
    if(!fs.existsSync(path.resolve(path.dirname(full),link[1])))problems.push(`Missing documentation target: ${name} -> ${link[1]}`);
  }
  if(!/\.m?js$/.test(name))continue;
  const syntax=spawnSync(process.execPath,['--check',...(name.startsWith('public/')||name.endsWith('.mjs')?['--input-type=module']:[])],{input:text,encoding:'utf8',windowsHide:true});
  if(syntax.status!==0)problems.push(`Syntax: ${name}\n${syntax.stderr}`);
  const group=name.split('/')[0];
  if(allowed[group]&&text.split('\n').length>300)problems.push(`Review module size (>300 lines): ${name}`);
  const edges=[];
  for(const match of text.matchAll(/(?:require\(\s*|from\s+|import\(\s*)['"](\.[^'"]+)['"]/g)){
    let target=path.resolve(path.dirname(full),match[1]);if(!path.extname(target))target+='.js';
    const relative=path.relative(root,target).replaceAll('\\','/');
    if(!names.includes(relative))problems.push(`Missing or outside dependency: ${name} -> ${relative}`);
    if(allowed[group]&&!allowed[group].includes(relative.split('/')[0]))problems.push(`Module boundary: ${name} -> ${relative}`);
    edges.push(relative);
  }
  graph.set(name,edges);
}
function walk(name,visiting,done){
  if(visiting.has(name)){problems.push(`Circular module dependency: ${[...visiting,name].join(' -> ')}`);return;}
  if(done.has(name))return;
  const next=new Set(visiting).add(name);for(const edge of graph.get(name)||[])walk(edge,next,done);done.add(name);
}
const done=new Set();for(const name of graph.keys())walk(name,new Set(),done);
const lock=JSON.parse(fs.readFileSync(path.join(root,'package-lock.json'),'utf8'));
for(const [name,pkg]of Object.entries(lock.packages))if(pkg.resolved&&!pkg.resolved.startsWith('https://registry.npmjs.org/'))problems.push(`Non-public dependency registry: ${name}`);
if(problems.length){console.error([...new Set(problems)].join('\n'));process.exitCode=1;}
else console.log(`OK: ${names.length} allowlisted files; syntax, module boundaries, cycles, size and sensitive-pattern scan`);
