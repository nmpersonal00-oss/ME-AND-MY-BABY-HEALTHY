import { createClient } from "npm:@supabase/supabase-js@2.58.0";
import webpush from "npm:web-push@3.6.7";
const url=Deno.env.get("SUPABASE_URL")||"";
const service=Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")||"";
const db=createClient(url,service,{auth:{persistSession:false,autoRefreshToken:false}});
function parts(date,zone){
 const effectiveZone=(zone==="America/Winnipeg"&&date.getTime()>=Date.parse("2026-11-01T07:00:00Z"))?"Etc/GMT+5":zone;
 const p=new Intl.DateTimeFormat("en-US",{timeZone:effectiveZone,year:"numeric",month:"2-digit",day:"2-digit",hour:"2-digit",minute:"2-digit",hourCycle:"h23"}).formatToParts(date);
 const get=(t)=>p.find(x=>x.type===t)?.value||"";
 return {day:get("year")+"-"+get("month")+"-"+get("day"),time:get("hour")+":"+get("minute"),hour:Number(get("hour"))};
}
function days(a,b){return Math.round((Date.parse(b+"T12:00:00Z")-Date.parse(a+"T12:00:00Z"))/86400000)}
function occurs(e,day){
 if(!e?.date||day<e.date||(e.until&&day>e.until)||(e.skipped||[]).includes(day))return false;
 const diff=days(e.date,day);if(diff<0)return false;
 const rep=e.repeat||"none";
 if(rep==="daily")return true;
 if(rep==="weekly")return diff%7===0;
 if(rep==="weekdays"){const d=new Date(day+"T12:00:00Z").getUTCDay();return d!==0&&d!==6}
 if(rep==="monthly")return e.date.slice(8)===day.slice(8);
 if(rep==="yearly")return e.date.slice(5)===day.slice(5);
 return e.date===day;
}
function habitDay(p){
 if(p.hour>=3)return p.day;
 const d=new Date(p.day+"T12:00:00Z");d.setUTCDate(d.getUTCDate()-1);return d.toISOString().slice(0,10);
}
function reminders(doc,now){
 const out=[];
 let calendar=[],habits=null;
 try{calendar=JSON.parse(doc.calendar||"[]")}catch{}
 try{habits=JSON.parse(doc.habits||"null")}catch{}
 const validClock=value=>typeof value==="string"&&/^([01][0-9]|2[0-3]):[0-5][0-9]$/.test(value);
 for(const e of Array.isArray(calendar)?calendar:[]){
   const lead=Number(e.remind);
   if(e.remind==null||e.remind==="none"||!Number.isFinite(lead)||lead<0||lead>10080)continue;
   const zone=e.timeZone==="America/Winnipeg"?"America/Winnipeg":"America/Los_Angeles";
   const scheduled=e.allDay?"09:00":e.time||"09:00";
   if(!validClock(scheduled))continue;
   for(let lag=0;lag<3;lag++){
     const p=parts(new Date(now.getTime()+(lead-lag)*60000),zone);
     if(p.time!==scheduled||!occurs(e,p.day)||(Array.isArray(e.done)&&e.done.includes(p.day)))continue;
     // The event's canonical time zone is shared by both devices; changes to a
     // date/time/zone/lead create distinct claims without repeating old alerts.
     const key=["cal",e.id||"event",p.day,lead,scheduled,zone,e.repeat||"none"].join("|");
     out.push({key,body:String(e.title||"Calendar reminder").slice(0,180),kind:"calendar"});
     break;
   }
 }
 if(habits&&Array.isArray(habits.habits)){
   for(const h of habits.habits){
     if(!h.remind||!validClock(h.time))continue;
     const zone=h.timeZone==="America/Winnipeg"?"America/Winnipeg":"America/Los_Angeles";
     for(let lag=0;lag<3;lag++){
       const p=parts(new Date(now.getTime()-lag*60000),zone);
       if(h.time!==p.time)continue;
       const day=habitDay(p),interval=Math.max(1,Number(h.interval)||1);
       const diff=days(h.anchor||day,day);
       if(diff<0||diff%interval!==0)break;
       const progressKey=day+"|"+h.id;
       if(h.type==="counter"?Number(habits.counts?.[progressKey]||0)>=Number(h.goal||1):!!habits.done?.[progressKey])break;
       const key=["habit",h.id||"habit",day,h.time,zone,interval].join("|");
       out.push({key,body:"Time for "+String(h.name||"your habit").slice(0,150),kind:"habit"});
       break;
     }
   }
 }
 return out;
}

Deno.serve(async request=>{
 if(request.method!=="POST")return new Response("Method not allowed",{status:405});
 if(!url||!service)return new Response("Backend configuration unavailable",{status:503});
 const {data:secretData,error:secretError}=await db.rpc("wh_server_push_secrets");
 if(secretError||!secretData)return new Response("Push credentials unavailable",{status:503});
 const s=secretData;
 if(!s.wh_cron_secret||request.headers.get("x-cron-secret")!==s.wh_cron_secret)return new Response("Unauthorized",{status:401});
 if(!s.wh_vapid_public||!s.wh_vapid_private)return new Response("VAPID keys missing",{status:503});
 webpush.setVapidDetails(s.wh_vapid_subject||"https://github.com/nmpersonal00-oss/ME-AND-MY-BABY-HEALTHY",s.wh_vapid_public,s.wh_vapid_private);
 const [docs,subs]=await Promise.all([
  db.from("wh_documents").select("user_id,document_key,value").in("document_key",["wifey-hubby-calendar-v1","wifey-hubby-habits-v4"]).limit(2000),
  db.from("wh_push_subscriptions").select("user_id,endpoint,p256dh,auth,time_zone").eq("enabled",true).limit(2000)
 ]);
 if(docs.error||subs.error){console.error("Reminder database fetch failed");return new Response("Database query failed",{status:500})}
 const byUser=new Map();
 for(const d of docs.data||[]){
   let x=byUser.get(d.user_id);
   if(!x){x={};byUser.set(d.user_id,x)}
   x[d.document_key==="wifey-hubby-calendar-v1"?"calendar":"habits"]=d.value;
 }
 // Authorized dry-run diagnostic. Does not claim or send and returns no note contents.
 let input={};try{input=await request.json()}catch{}
 const dryRun=input?.dryRun===true;
 const iso=typeof input?.previewNow==="string"?input.previewNow:"";
 const previewNow=dryRun&&/^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}(?:[.][0-9]+)?Z$/.test(iso)?new Date(iso):null;
 const now=previewNow&&Number.isFinite(previewNow.getTime())?previewNow:new Date();
 const byUserDue=new Map();
 let checked=0,sent=0,failed=0,calendarDue=0,habitsDue=0;
 for(const sub of subs.data||[]){
   let due=byUserDue.get(sub.user_id);
   if(!due){
     try{due=reminders(byUser.get(sub.user_id)||{},now)}
     catch(error){failed++;console.error("Schedule evaluation failed",String(error));continue}
     byUserDue.set(sub.user_id,due);
   }
   for(const item of due){
     checked++;
     if(item.kind==="calendar")calendarDue++;else if(item.kind==="habit")habitsDue++;
     if(dryRun)continue;
     const {data:claim,error:claimError}=await db.from("wh_push_deliveries")
       .upsert({user_id:sub.user_id,endpoint:sub.endpoint,reminder_key:item.key},
         {onConflict:"user_id,endpoint,reminder_key",ignoreDuplicates:true})
       .select("reminder_key");
     if(claimError){failed++;console.error("Reminder claim failed",claimError.code);continue}
     if(!claim?.length)continue;
     try{
       await webpush.sendNotification({endpoint:sub.endpoint,keys:{p256dh:sub.p256dh,auth:sub.auth}},
         JSON.stringify({title:"Daily Sweets",body:item.body,tag:item.key}),
         {TTL:86400,urgency:"normal"});
       sent++;
     }catch(error){
       failed++;
       const status=Number(error?.statusCode)||0;
       console.error("Web Push delivery failed",status,String(error));
       if(status===404||status===410)
         await db.from("wh_push_subscriptions").update({enabled:false}).eq("endpoint",sub.endpoint);
       else await db.from("wh_push_deliveries").delete()
         .eq("user_id",sub.user_id).eq("endpoint",sub.endpoint).eq("reminder_key",item.key);
     }
   }
 }
 return Response.json({checked,sent,failed,calendarDue,habitsDue,activeDevices:(subs.data||[]).length,
  ...(dryRun?{dryRun:true,previewNow:now.toISOString()}:{})});
});
