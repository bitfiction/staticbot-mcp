import assert from 'node:assert/strict';
import { createServer as createHttpServer } from 'node:http';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../dist/server/create-server.js';
import { createApiKeyContext } from '../dist/context.js';
import { createDelegatedContext } from '../dist/hosted/context.js';

const id='00000000-0000-4000-8000-000000000931';
const version='a'.repeat(64);
const requests=[];
const fixture=createHttpServer(async (req,res)=>{
  let raw=''; for await(const chunk of req) raw+=chunk;
  const body=raw?JSON.parse(raw):null;
  requests.push({path:req.url,method:req.method,body,headers:req.headers});
  const send=(status,data)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(data));};
  if(body?.expectedState==='b'.repeat(64)) return send(409,{detail:'The inspected cutover state changed. Inspect and obtain fresh approval.'});
  if(body?.expectedState==='c'.repeat(64)) return send(503,{detail:'Unknown outcome; inspect the current run before another action.'});
  if(req.url===`/api/v1/connected-projects/${id}/cutover` || req.url.endsWith('/cutover/check'))
    return send(200,{available:true,source:{kind:'BASE44',appId:'app'},targetProjectRef:'target',
      copiedThrough:'2026-10-01T00:00:00Z',copyFinishedAt:'2026-10-01T00:01:00Z',stateVersion:version,
      switchState:'UNKNOWN',checking:true,drift:{state:'UNREADABLE',truncated:true},copy:{canStart:false}});
  if(req.url.endsWith('/cutover/copy')) return send(202,{runId:id,status:'IN_PROGRESS',message:'Copy queued'});
  if(req.url.endsWith('/cutover/conflicts/reviewed')) return send(200,{available:true,copy:{canMarkReviewed:false}});
  send(404,{detail:'Unexpected route'});
});
await new Promise((resolve,reject)=>{fixture.once('error',reject);fixture.listen(0,'127.0.0.1',resolve);});
const apiUrl=`http://127.0.0.1:${fixture.address().port}`;
const actor={subject:'cutover-user',username:'reviewer',email:'reviewer@example.invalid',oauthClientId:'cutover-contract',scopes:['staticbot:read','staticbot:write']};
let calls=0;
try {
  for(const [name,context,bearer] of [
    ['API-key',createApiKeyContext(apiUrl,'cutover-api-key'),'cutover-api-key'],
    ['OAuth',createDelegatedContext({apiUrl},actor,async()=>'cutover-service'),'cutover-service'],
  ]) {
    const first=requests.length;
    const server=createServer(context); const client=new Client({name:`cutover-${name}`,version:'1'},{capabilities:{}});
    const [ct,st]=InMemoryTransport.createLinkedPair();await server.connect(st);await client.connect(ct);
    try {
      const {tools}=await client.listTools();
      const descriptor=n=>{const t=tools.find(t=>t.name===n);assert(t,n);return t;};
      const call=async(name,args)=>{calls++;return client.callTool({name,arguments:args});};
      const ok=async(name,args)=>{const r=await call(name,args);assert.notEqual(r.isError,true,JSON.stringify(r));return r.structuredContent.result;};
      assert.equal(descriptor('get_connected_project_cutover').annotations.readOnlyHint,true);
      assert.equal(descriptor('check_connected_project_cutover').annotations.readOnlyHint,false);
      for(const tool of ['copy_connected_project_late_changes','mark_cutover_conflicts_reviewed']) {
        assert.equal(descriptor(tool).annotations.destructiveHint,true);
        assert(descriptor(tool).inputSchema.required.includes('confirmed'));
        assert(descriptor(tool).inputSchema.required.includes('expectedState'));
        assert.match(descriptor(tool).description,/fresh.*approval/);
        assert.match(descriptor(tool).description,/never retry/i);
      }
      const beforeRead=requests.length;
      const state=await ok('get_connected_project_cutover',{id});
      assert.equal(state.switchState,'UNKNOWN');assert.equal(state.drift.state,'UNREADABLE');assert.equal(state.drift.truncated,true);
      assert.equal(state.stateVersion,version);assert.equal(requests.length,beforeRead+1);
      assert.equal(requests.at(-1).method,'GET');
      const beforeCheck=requests.length;
      const check=await ok('check_connected_project_cutover',{id});assert.equal(check.checking,true);
      assert.equal(requests.length,beforeCheck+1,'Check must not automatically copy');
      assert.equal(requests.at(-1).method,'POST');assert.equal(requests.at(-1).body,null);
      for(const mode of ['INSERT_ONLY','FULL_UPDATE']) {
        const before=requests.length;
        const copied=await ok('copy_connected_project_late_changes',{id,mode,expectedState:state.stateVersion,confirmed:true});
        assert.equal(copied.status,'IN_PROGRESS');assert.equal(requests.length,before+1,'Copy must not implicitly review or retry');
        assert.deepEqual(requests.at(-1).body,{mode,expectedState:version,confirmed:true});
        assert.equal(requests.at(-1).path,`/api/v1/connected-projects/${id}/cutover/copy`);
      }
      await ok('mark_cutover_conflicts_reviewed',{id,expectedState:version,confirmed:true});
      assert.deepEqual(requests.at(-1).body,{expectedState:version,confirmed:true});
      assert.equal(requests.at(-1).path,`/api/v1/connected-projects/${id}/cutover/conflicts/reviewed`);
      const beforeInvalid=requests.length;
      for(const [tool,args] of [
        ['copy_connected_project_late_changes',{id,mode:'INSERT_ONLY',expectedState:version}],
        ['copy_connected_project_late_changes',{id,mode:'FULL_UPDATE',expectedState:version,confirmed:false}],
        ['copy_connected_project_late_changes',{id,expectedState:version,confirmed:true}],
        ['copy_connected_project_late_changes',{id,mode:'GUESS',expectedState:version,confirmed:true}],
        ['copy_connected_project_late_changes',{id,mode:'INSERT_ONLY',expectedState:'guess',confirmed:true}],
        ['mark_cutover_conflicts_reviewed',{id,confirmed:true}],
        ['mark_cutover_conflicts_reviewed',{id,expectedState:version,confirmed:false}],
      ]) assert.equal((await call(tool,args)).isError,true,`${tool}: invalid input must fail`);
      assert.equal(requests.length,beforeInvalid,'Invalid approvals must never reach HTTP');
      for(const expectedState of ['b'.repeat(64),'c'.repeat(64)]) {
        for(const tool of ['copy_connected_project_late_changes','mark_cutover_conflicts_reviewed']) {
          const before=requests.length;
          assert.equal((await call(tool,{id,mode:'FULL_UPDATE',expectedState,confirmed:true})).isError,true);
          assert.equal(requests.length,before+1,'No automatic retry or state substitution on 409/unknown outcome');
        }
      }
      for(const request of requests.slice(first)) {
        assert.equal(request.headers.authorization,`Bearer ${bearer}`);
        if(name==='OAuth') { assert.equal(request.headers['x-staticbot-actor-subject'],actor.subject); assert.equal(request.headers['x-staticbot-actor-scopes'],'staticbot:read staticbot:write'); }
      }
    } finally {await client.close();await server.close();}
  }
  console.log(`Cutover contracts passed: ${calls} tool calls across API-key and OAuth contexts, exact-state forwarding, explicit modes/approval, unknown evidence and no automatic copy/review/retry`);
} finally {await new Promise(resolve=>fixture.close(resolve));}
