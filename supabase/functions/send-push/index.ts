import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Payload = { eventKey:string; groupId:string; category:'chat'|'metric'|'lead'; title:string; body:string; recipientId?:string; metricId?:string; data?:Record<string,string> };
const cors={ 'Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'authorization, x-client-info, apikey, content-type' };

Deno.serve(async(req)=>{
  if(req.method==='OPTIONS')return new Response('ok',{headers:cors});
  try{
    const url=Deno.env.get('SUPABASE_URL')!; const service=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const auth=req.headers.get('Authorization')??''; const admin=createClient(url,service);
    const {data:{user},error:userError}=await admin.auth.getUser(auth.replace(/^Bearer\s+/i,''));
    if(userError||!user)return json({error:'Unauthorized'},401);
    const payload=await req.json() as Payload;
    const {data:membership}=await admin.from('group_members').select('user_id').eq('group_id',payload.groupId).eq('user_id',user.id).maybeSingle();
    if(!membership)return json({error:'Not a group member'},403);
    const {data:claimed,error:eventError}=await admin
      .from('push_events')
      .upsert(
        {event_key:payload.eventKey,sender_id:user.id},
        {onConflict:'event_key',ignoreDuplicates:true},
      )
      .select('event_key');
    if(eventError)throw eventError;
    if(!claimed?.length)return json({sent:0,deduplicated:true});
    let members=admin.from('group_members').select('user_id').eq('group_id',payload.groupId).neq('user_id',user.id);
    if(payload.recipientId)members=members.eq('user_id',payload.recipientId);
    const {data:recipients,error:memberError}=await members;if(memberError)throw memberError;
    const ids=(recipients??[]).map((item)=>item.user_id);if(!ids.length)return json({sent:0});
    const {data:tokens,error:tokenError}=await admin.from('device_push_tokens').select('token, preferences').in('user_id',ids);if(tokenError)throw tokenError;
    const messages=(tokens??[]).filter((item)=>allowed(item.preferences??{},payload)).map((item)=>({to:item.token,sound:'default',channelId:'paceboard',title:payload.title,body:payload.body,data:payload.data??{}}));
    if(messages.length){const response=await fetch('https://exp.host/--/api/v2/push/send',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(messages)});if(!response.ok)throw new Error(`Expo push failed: ${response.status}`);}
    return json({sent:messages.length});
  }catch(error){return json({error:error instanceof Error?error.message:String(error)},500);}
});
function allowed(settings:Record<string,unknown>,payload:Payload){if(settings.pushEnabled===false||inQuietHours(settings))return false;const mutedGroups=Array.isArray(settings.mutedGroupIds)?settings.mutedGroupIds:[];if(mutedGroups.includes(payload.groupId))return false;const conversationId=payload.data?.conversationId;const mutedChats=Array.isArray(settings.mutedConversationIds)?settings.mutedConversationIds:[];if(payload.category==='chat'&&(settings.chatMessages===false||conversationId&&mutedChats.includes(conversationId)))return false;if(payload.category==='lead'&&settings.leadChanges===false)return false;if(payload.category==='metric'&&settings.groupMetricActivity===false)return false;const ids=Array.isArray(settings.metricIds)?settings.metricIds:[];return !payload.metricId||!ids.length||ids.includes(payload.metricId);}
function inQuietHours(settings:Record<string,unknown>){if(settings.quietHoursEnabled!==true)return false;try{const parts=new Intl.DateTimeFormat('en-GB',{timeZone:String(settings.timezone||'UTC'),hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(new Date());const now=Number(parts.find((part)=>part.type==='hour')?.value||0)*60+Number(parts.find((part)=>part.type==='minute')?.value||0);const minutes=(value:unknown)=>{const [hour,minute]=String(value||'').split(':').map(Number);return Number.isFinite(hour)&&Number.isFinite(minute)?hour*60+minute:0;};const start=minutes(settings.quietHoursStart),end=minutes(settings.quietHoursEnd);return start===end?false:start<end?now>=start&&now<end:now>=start||now<end;}catch{return false;}}
function json(body:unknown,status=200){return new Response(JSON.stringify(body),{status,headers:{...cors,'Content-Type':'application/json'}});}
