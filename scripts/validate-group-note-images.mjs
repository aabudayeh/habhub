import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { safeRichNoteLink, richNotePlainText } from "../src/domain/richNoteValue.ts";

const group="00000000-0000-4000-8000-000000000101";
const owner="00000000-0000-4000-8000-000000000001";
const source=fs.readFileSync("src/cloud/groupHubContent.ts","utf8");
const editor=fs.readFileSync("src/components/GroupNoteEditorSheet.tsx","utf8");
const toolbar=fs.readFileSync("src/components/RichNoteFormattingToolbar.tsx","utf8");
const tick=()=>new Promise((resolve)=>setImmediate(resolve));

function fixture({ lostSave=false, rejectSave=false, rejectUpload=false, rejectSigning=false, cleanupError=false, rows=[] }={}) {
  const calls=[]; const records=[...rows];
  const client={
    auth:{ getSession:async()=>({data:{session:{user:{id:owner}}}}) },
    functions:{invoke:async(name,input)=>{calls.push([name,input]);return {error:cleanupError?new Error("offline"):null};}},
    storage:{from:()=>({
      upload:async(path)=>{calls.push(["upload",path]);return {error:rejectUpload?new Error("upload response lost"):null};},
      createSignedUrls:async(paths)=>{calls.push(["sign",paths]);if(rejectSigning)throw new Error("offline");return {data:paths.map((path)=>({path,signedUrl:"https://signed.test/"+path}))};},
    })},
    rpc:async(name,input)=>{
      calls.push([name,input]);
      if(name==="save_group_note"){
        const row={id:"new-note",group_id:input.p_group_id,creator_id:owner,title:input.p_title,body:input.p_body,
          image_path:input.p_image_path,image_owner_id:input.p_image_path?owner:null,revision:1,created_at:"2026-09-09",updated_at:"2026-09-09"};
        if(!rejectSave)records.push(row);
        return {data:row,error:lostSave||rejectSave?new Error("save response lost"):null};
      }
      return {data:null,error:null};
    },
    from:()=>{
      const filters=[];let limit=Infinity;
      const result=()=>({data:records.filter((row)=>filters.every(([key,value])=>row[key]===value)).slice(0,limit),error:null});
      const query={select(){return query;},eq(key,value){filters.push([key,value]);return query;},order(){return query;},
        limit(value){limit=value;return query;},abortSignal(){return query;},maybeSingle:async()=>({...result(),data:result().data[0]??null}),
        then(resolve,reject){return Promise.resolve(result()).then(resolve,reject);}};
      return query;
    },
  };
  const module={exports:{}};
  const compiled=ts.transpileModule(source+"\nexport { cleanupGroupNoteImages };",{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(compiled,{module,exports:module.exports,Map,Set,Date,Math,Promise,Error,
    fetch:async()=>new Response(new Uint8Array([1,2,3]),{headers:{"content-type":"image/png"}}),
    require:(name)=> name.endsWith("/supabase")?{supabase:client}:name.endsWith("/groupCloud")?{
      dispatchCommittedGroupPushEvent:async()=>{},flushPendingGroupPushEvents:async()=>{},
    }:{} });
  return {api:module.exports,calls};
}

const input={groupId:group,title:"Plan",body:"## Weekend\n**Bring water**",imageUploadUri:"blob:fixture-image"};
const normal=fixture();
const saved=await normal.api.saveGroupNote(input); await tick();
const stageAt=normal.calls.findIndex(([name])=>name==="stage_group_note_image");
const uploadAt=normal.calls.findIndex(([name])=>name==="upload");
const saveAt=normal.calls.findIndex(([name])=>name==="save_group_note");
assert(stageAt>=0&&stageAt<uploadAt&&uploadAt<saveAt,"Authoritative stage precedes object upload and publication");
assert.equal(saved.body,input.body); assert.equal(saved.imageUri,input.imageUploadUri);
assert(saved.imageStoragePath.startsWith(owner+"/account/group-note/"));
assert(!normal.calls.find(([name])=>name==="save_group_note")[1].p_image_path.startsWith("blob:"));
await normal.api.loadGroupNotes(group); await normal.api.loadGroupNotes(group); await tick();
assert.equal(normal.calls.filter(([name])=>name==="group-note-media").length,1,"Realtime loads respect successful cleanup cooldown");
await normal.api.deleteGroupNote("new-note",1,group); await tick();
assert.equal(normal.calls.filter(([name])=>name==="group-note-media").length,2,"A mutation forces cleanup despite the load cooldown");
const lost=fixture({lostSave:true});
assert.equal((await lost.api.saveGroupNote(input)).id,"new-note","Lost response recovers the committed row, never deletes its image");
assert(lost.calls.some(([name])=>name==="retire_unpublished_group_note_image"));
const failed=fixture({rejectSave:true});
await assert.rejects(failed.api.saveGroupNote(input),/save response lost/);
assert(failed.calls.some(([name])=>name==="retire_unpublished_group_note_image"));
const uploadLost=fixture({rejectUpload:true});
await assert.rejects(uploadLost.api.saveGroupNote(input),/upload response lost/);
assert(uploadLost.calls.some(([name])=>name==="stage_group_note_image"));
assert(uploadLost.calls.some(([name])=>name==="retire_unpublished_group_note_image"));
const signing=fixture({rejectSigning:true});
assert.equal((await signing.api.saveGroupNote(input)).id,"new-note","Image URL refresh errors do not roll back committed content");
const backlog=fixture({rows:Array.from({length:251},(_,i)=>({id:String(i),group_id:group,creator_id:owner,body:"x",image_path:owner+"/account/group-note/"+i+".jpg",revision:1}))});
assert.equal((await backlog.api.loadGroupNotes(group)).length,250);
assert.deepEqual(backlog.calls.filter(([name])=>name==="sign").map(([,paths])=>paths.length),[100,100,50]);
const cooldownError=fixture({cleanupError:true});
await cooldownError.api.cleanupGroupNoteImages(group); await cooldownError.api.cleanupGroupNoteImages(group);
assert.equal(cooldownError.calls.filter(([name])=>name==="group-note-media").length,1,"Failure cooldown prevents per-realtime retry storms");
await cooldownError.api.cleanupGroupNoteImages(group,true);
assert.equal(cooldownError.calls.filter(([name])=>name==="group-note-media").length,2,"A new mutation can retry failed cleanup immediately");

for(const bad of ["javascript:alert(1)","data:text/html,test","intent://app","https://user:pass@example.com","https://example.com\nInjected"])
  assert.equal(safeRichNoteLink(bad),undefined);
assert.equal(safeRichNoteLink("example.com",true),"https://example.com/");
assert.equal(richNotePlainText("## Weekend\n**Bring water**\n- [ ] Shoes\n[Route](https://example.com)"),"Weekend\nBring water\nShoes\nRoute");
for(const command of ["undo","redo","setBlock","toggleInline"]) assert(toolbar.includes(`composer.current?.${command}`));
assert.match(editor,/<RichNoteComposer/); assert.match(editor,/<RichNoteFormattingToolbar/);
assert.match(editor,/imageStoragePath.*imageUploadUri/);
assert.match(editor,/operationActive\.current/);
assert.match(editor,/useWebBeforeUnload/);
assert.match(editor,/contentFit="contain"/);

// Exercise the deployed Edge handler with a mocked auth/RPC/Storage boundary.
const edge=fs.readFileSync("supabase/functions/group-note-media/index.ts","utf8").replace(/^import .*?;\s*/s,"");
async function edgeFixture({authenticated=true,rpcError=false,paths=[],removeError=false}={},body={groupId:group}) {
  let handler;const removed=[];
  const compiled=ts.transpileModule(edge,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  vm.runInNewContext(compiled,{Request,Response,JSON,Set,
    Deno:{env:{get:(name)=>name==="SUPABASE_SERVICE_ROLE_KEY"?"service":"fixture"},serve:(value)=>{handler=value;}},
    createClient:(_url,key)=>key==="service"?{storage:{from:()=>({remove:async(values)=>{removed.push(...values);return {error:removeError?new Error("failed"):null};}})}}:
      {auth:{getUser:async()=>({data:{user:authenticated?{id:owner}:null},error:null})},rpc:async()=>({data:paths.map((path)=>({path})),error:rpcError?new Error("forbidden"):null})},
  });
  const result=await handler(new Request("https://fixture.test/group-note-media",{method:"POST",headers:{Authorization:"Bearer fixture"},body:JSON.stringify(body)}));
  return {result,removed};
}
const authorizedPaths=Array.from({length:100},(_,i)=>owner+"/account/group-note/"+i+".jpg");
assert.equal((await edgeFixture({paths:authorizedPaths})).removed.length,100);
assert.equal((await edgeFixture({authenticated:false,paths:authorizedPaths})).result.status,401);
assert.equal((await edgeFixture({rpcError:true,paths:authorizedPaths})).removed.length,0);
assert.equal((await edgeFixture({paths:["other-private-file"]})).removed.length,0);
assert.equal((await edgeFixture({paths:[...authorizedPaths,authorizedPaths[0]]})).removed.length,0);
assert.equal((await edgeFixture({paths:authorizedPaths,removeError:true})).result.status,503);
assert.equal((await edgeFixture({paths:[]},{groupId:group,path:owner+"/private.jpg"})).removed.length,0,"Caller-supplied path never grants cleanup authority");
console.log("Group-note image client, cleanup endpoint, shared formatting, safe links, upload/lost-response handling and bounded/cooldown regression checks passed.");
