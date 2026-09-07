import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { createServer as httpServer } from 'node:http';
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { mkdtemp, writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const resources = process.env.KNOB_DESKTOP_RESOURCES;
if (!resources) throw new Error('An explicit isolated desktop resources directory is required');
const native = resources + '/codex', signedNode = resources + '/cua_node/bin/node';
const plugin = resources + '/plugins/openai-bundled/plugins/codex-app-tools';
const entrypoint = fileURLToPath(new URL('../../bin/thinking-knob-desktop', import.meta.url));
const authorizer = createRequire(import.meta.url)(resources + '/native/browser-use-peer-authorization.node');
if (!process.env.KNOB_TEST_ROOT) throw new Error('A fixture-owned test root is required');
const root = await mkdtemp(join(process.env.KNOB_TEST_ROOT, 'knob-chain-'));
const report = { root, scope: 'Real native peer authorization with fixture App Servers inside a disposable VM', cases: [] };

for (const name of ['native', 'desktop-entrypoint']) {
  const dir = join(root, name); await mkdir(dir);
  const socketPath = join(dir, 'app.sock');
  const checks = [], sockets = new Set();
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); socket.on('error', () => {});
    const verdict = authorizer.authorizeSocketPeer(socket._handle.fd, false); checks.push(verdict);
    if (!verdict.authorized) { socket.destroy(); return; }
    let data = Buffer.alloc(0);
    socket.on('data', chunk => {
      data = Buffer.concat([data, chunk]);
      while (data.length >= 4 && data.length >= data.readUInt32LE(0) + 4) {
        const size = data.readUInt32LE(0), request = JSON.parse(data.subarray(4, size + 4));
        data = data.subarray(size + 4);
        const payload = Buffer.from(JSON.stringify({jsonrpc:'2.0',id:request.id,result:{tools:[]}}));
        const frame = Buffer.alloc(4 + payload.length); frame.writeUInt32LE(payload.length); payload.copy(frame,4); socket.write(frame);
      }
    });
  });
  await new Promise(resolve => server.listen(socketPath, resolve));
  let requestCount = 0;
  const fixture = httpServer(async (req, res) => {
    for await (const chunk of req) {} requestCount++;
    const item = {type:'message',id:'fixture-message',role:'assistant',status:'completed',content:[{type:'output_text',text:'Fixture complete.',annotations:[]}]};
    res.writeHead(200, {'Content-Type':'text/event-stream'});
    for (const event of [
      {type:'response.created',response:{id:'fixture',status:'in_progress',output:[]}},
      {type:'response.output_item.added',output_index:0,item},
      {type:'response.output_item.done',output_index:0,item},
      {type:'response.completed',response:{id:'fixture',status:'completed',output:[item],usage:{input_tokens:1,output_tokens:1,total_tokens:2}}}
    ]) res.write('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n');
    res.end();
  });
  await new Promise(resolve => fixture.listen(0,'127.0.0.1',resolve));
  await writeFile(join(dir,'config.toml'), `model = "gpt-6-astra"
model_provider = "fixture"
approval_policy = "never"
sandbox_mode = "read-only"
cli_auth_credentials_store = "file"
[model_providers.fixture]
name = "Local fixture"
base_url = "http://127.0.0.1:${fixture.address().port}"
wire_api = "responses"
requires_openai_auth = false
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
[mcp_servers.codex_app]
command = "${plugin}/scripts/launch_codex_app_tools_mcp"
args = ["./server.mjs"]
cwd = "${plugin}"
startup_timeout_sec = 10
[mcp_servers.codex_app.env]
CODEX_MCP_NODE_PATH = "${signedNode}"
CODEX_APP_TOOLS_PIPE_PATH = "${socketPath}"
`);
  const command = name === 'native' ? native : entrypoint;
  const args = ['app-server'];
  const child = spawn(command,args,{cwd:dir,env:{PATH:process.env.KNOB_TEST_PATH ?? '/usr/bin:/bin',CODEX_HOME:dir,CODEX_SQLITE_HOME:dir,KNOB_NATIVE_BINARY:native},stdio:['pipe','pipe','pipe'],detached:true});
  const closed = new Promise(resolve => child.once('close',resolve));
  let stderr='', sequence=0; const pending = new Map(), events=[];
  child.stderr.on('data', chunk => {stderr += chunk;});
  createInterface({input:child.stdout}).on('line', line => {
    const m=JSON.parse(line); if(pending.has(m.id)){pending.get(m.id)(m);pending.delete(m.id);}else events.push(m);
  });
  const rpc=(method,params)=>new Promise(resolve=>{const id=++sequence;pending.set(id,resolve);child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  let timer;
  try {
    const outcome=await Promise.race([(async()=>{
      await rpc('initialize',{clientInfo:{name:'knob_chain_fixture',version:'1'},capabilities:{experimentalApi:true}});
      child.stdin.write(JSON.stringify({method:'initialized'})+'\n');
      const started=await rpc('thread/start',{model:'gpt-6-astra',cwd:dir});
      if(started.error)return started;
      await rpc('turn/start',{threadId:started.result.thread.id,input:[{type:'text',text:'Run the fixture.',text_elements:[]}]});
      for(let i=0;i<100;i++){if(events.some(e=>e.method==='turn/completed'))break;await new Promise(r=>setTimeout(r,100));}
      return {checks,requestCount,completed:events.filter(e=>e.method==='turn/completed').map(e=>e.params.turn.status)};
    })(),new Promise(resolve=>{timer=setTimeout(()=>resolve({timeout:true}),20000);})]);
    report.cases.push({name,outcome,checks,stderr});
    console.log(JSON.stringify({name,outcome,checks}));
  } finally {
    clearTimeout(timer);try{process.kill(-child.pid,'SIGTERM');}catch{}
    const force=setTimeout(()=>{try{process.kill(-child.pid,'SIGKILL');}catch{}},2000);
    await closed;clearTimeout(force);for(const s of sockets)s.destroy();await new Promise(r=>server.close(r));
    fixture.closeAllConnections();await new Promise(r=>fixture.close(r));
  }
}
await writeFile(join(root, 'result.json'),JSON.stringify(report,null,2));
