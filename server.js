const https = require('https');
const fs = require('fs');
const http = require('http');

// ==================== CONFIG SCANNER 1 (WATCH LIST) ====================
const DYNMAP_URL = process.env.DYNMAP_URL || 'https://lime.nationsglory.fr/standalone/dynmap_world.json';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || '';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 1000;
const MESSAGE_FILE = 'message_id.txt';
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://nationsglory-scanner2.onrender.com';

const WATCH_LIST = [
  'Canisi','Darkholess','UFO_Thespoot','firecharge94','Franky753',
  'Blakonne','Thepainx31x','Farsgame','ClashKiller78','Olmat38','AstaPatate'
];

// ==================== CONFIG SCANNER 2 (NATIONS) ====================
const WEBHOOK_URL_2 = process.env.DISCORD_WEBHOOK_2 || '';
const API_KEY = process.env.NG_API_KEY || 'NGAPI_KEY';
const MESSAGE_FILE_2 = 'message_id_2.txt';
const NATIONS_TO_WATCH = ['coreedunord','armenie'];

// ==================== VERIFICATION WEBHOOKS ====================
if (!WEBHOOK_URL || !WEBHOOK_URL_2) {
  console.error('❌ Webhook manquant');
  process.exit(1);
}

// ==================== VARIABLES ====================
let messageId = null, webhookId = null, webhookToken = null;
let messageId2 = null, webhookId2 = null, webhookToken2 = null;

let lastDiscordRequest = 0;
const DISCORD_DELAY = 500;

// ==================== UTILS ====================
async function waitForRateLimit() {
  const diff = Date.now() - lastDiscordRequest;
  if (diff < DISCORD_DELAY) await new Promise(r => setTimeout(r, DISCORD_DELAY - diff));
  lastDiscordRequest = Date.now();
}

function parseWebhook(url, second=false) {
  const p = url.split('/');
  second ? (webhookId2=p.at(-2), webhookToken2=p.at(-1))
         : (webhookId=p.at(-2), webhookToken=p.at(-1));
}

function saveMessageId(id,file,second=false){
  second ? messageId2=id : messageId=id;
  fs.writeFileSync(file,id);
}

function deleteMessageId(file,second=false){
  if(fs.existsSync(file)) fs.unlinkSync(file);
  second ? messageId2=null : messageId=null;
}

function fetchJSON(url){
  return new Promise((res,rej)=>{
    https.get(url,r=>{
      let d=''; r.on('data',c=>d+=c);
      r.on('end',()=>{ try{res(JSON.parse(d))}catch(e){rej(e)}});
    }).on('error',rej);
  });
}

function makeRequest(method,path,data=null){
  return new Promise((res,rej)=>{
    const opt={hostname:'discord.com',path,method,headers:{'Content-Type':'application/json'}};
    if(data){
      const p=JSON.stringify(data);
      opt.headers['Content-Length']=Buffer.byteLength(p);
    }
    const req=https.request(opt,r=>{
      let b=''; r.on('data',c=>b+=c);
      r.on('end',()=>{
        if(r.statusCode>=200&&r.statusCode<300) res(b?JSON.parse(b):null);
        else rej(new Error(`HTTP ${r.statusCode}: ${b}`));
      });
    });
    if(data) req.write(JSON.stringify(data));
    req.on('error',rej);
    req.end();
  });
}

// ==================== FIX CRITIQUE ICI ====================
async function sendOrEditMessage(embed, second=false, ping=false){
  try{
    await waitForRateLimit();
    const whId = second?webhookId2:webhookId;
    const whToken = second?webhookToken2:webhookToken;
    const msgId = second?messageId2:messageId;
    const file = second?MESSAGE_FILE_2:MESSAGE_FILE;

    const payload={embeds:[embed]};
    if(ping) payload.content='@everyone';

    if(msgId){
      try{
        await makeRequest(
          'PATCH',
          `/api/webhooks/${whId}/${whToken}/messages/${msgId}`,
          payload
        );
      }catch{
        // 🔒 reset total + recréation propre
        deleteMessageId(file,second);
        await waitForRateLimit();
        const r = await makeRequest(
          'POST',
          `/api/webhooks/${whId}/${whToken}?wait=true`,
          payload
        );
        saveMessageId(r.id,file,second);
      }
    }else{
      const r = await makeRequest(
        'POST',
        `/api/webhooks/${whId}/${whToken}?wait=true`,
        payload
      );
      saveMessageId(r.id,file,second);
    }
  }catch(e){
    console.error('❌ Discord:',e.message);
  }
}

// ==================== SCANNER 1 ====================
async function checkPlayers() {
  try {
    const data = await fetchJSON(DYNMAP_URL);
    const onlinePlayers = data.players.map(p => p.name);

    const watchedOnline = WATCH_LIST.filter(p=>onlinePlayers.includes(p));
    const watchedOffline = WATCH_LIST.filter(p=>!onlinePlayers.includes(p));

    const embed = {
      title: "🟢 RAPPORT TACTIQUE - LIME",
      color: watchedOnline.length ? 3066993 : 10197915,
      fields: [
        { name:"🟢 En ligne", value: watchedOnline.join('\n')||'Aucun' },
        { name:"⚪ Hors ligne", value: watchedOffline.join('\n')||'Aucun' }
      ],
      timestamp: new Date().toISOString()
    };

    await sendOrEditMessage(embed,false);
  } catch (e) {
    console.error('❌ Scanner 1:', e.message);
  }
}

// ==================== SCANNER 2 ====================
async function checkNations() {
  const embed = {
    title: "⚔️ SURVEILLANCE NATIONS - LIME",
    description: "Scanner actif",
    timestamp: new Date().toISOString()
  };
  await sendOrEditMessage(embed,true,false);
}

// ==================== INIT ====================
async function init() {
  parseWebhook(WEBHOOK_URL,false);
  parseWebhook(WEBHOOK_URL_2,true);

  await checkPlayers();
  await checkNations();

  setInterval(checkPlayers,CHECK_INTERVAL);
  setInterval(checkNations,CHECK_INTERVAL);
}

// ==================== SERVER ====================
const server = http.createServer((req,res)=>{
  res.writeHead(200);
  res.end('Scanner running');
});

server.listen(process.env.PORT||3000,()=>{
  console.log('🚀 Serveur ON');
  init();
});
