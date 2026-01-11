const https = require('https');
const fs = require('fs');
const http = require('http');

// ==================== CONFIG SCANNER 1 (WATCH LIST) ====================
const DYNMAP_URL = process.env.DYNMAP_URL || 'https://lime.nationsglory.fr/standalone/dynmap_world.json';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || '';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 1000;
const MESSAGE_FILE = 'message_id.txt';
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://nationsglory-scanner2.onrender.com';

// Liste des joueurs à surveiller (Scanner 1)
const WATCH_LIST = [
  'Canisi',
  'Darkholess',
  'UFO_Thespoot',
  'firecharge94',
  'Franky753',
  'Blakonne',
  'Thepainx31x',
  'Farsgame',
  'ClashKiller78',
  'Olmat38',
  'AstaPatate'
];

// ==================== CONFIG SCANNER 2 (NATIONS) ====================
const WEBHOOK_URL_2 = process.env.DISCORD_WEBHOOK_2 || '';
const API_KEY = process.env.NG_API_KEY || 'NGAPI_6CNZf5YqF*G%35ZSNgQmyeyBSmwO0YoD03248a59af4faf14ddc92a471abbabf9';
const MESSAGE_FILE_2 = 'message_id_2.txt';
const NATIONS_TO_WATCH = ['coreedunord', 'armenie'];

// ==================== VERIFICATION WEBHOOKS ====================
if (!WEBHOOK_URL) {
  console.error('❌ ERREUR: DISCORD_WEBHOOK non défini');
  process.exit(1);
}

if (!WEBHOOK_URL_2) {
  console.error('❌ ERREUR: DISCORD_WEBHOOK_2 non défini');
  process.exit(1);
}

// ==================== VARIABLES SCANNER 1 ====================
let messageId = null;
let webhookId = null;
let webhookToken = null;

// ==================== VARIABLES SCANNER 2 ====================
let messageId2 = null;
let webhookId2 = null;
let webhookToken2 = null;

// ==================== FONCTIONS COMMUNES ====================

// Webhook parse
function parseWebhook(url, isSecond = false) {
  const parts = url.split('/');
  const id = parts[parts.length - 2];
  const token = parts[parts.length - 1];
  
  if (isSecond) {
    webhookId2 = id;
    webhookToken2 = token;
  } else {
    webhookId = id;
    webhookToken = token;
  }
}

// Message ID
function loadMessageId(file, isSecond = false) {
  if (fs.existsSync(file)) {
    const id = fs.readFileSync(file, 'utf8').trim();
    if (isSecond) {
      messageId2 = id;
      console.log(`📝 Message ID 2 chargé: ${id}`);
    } else {
      messageId = id;
      console.log(`📝 Message ID chargé: ${id}`);
    }
  }
}

function saveMessageId(id, file, isSecond = false) {
  if (isSecond) {
    messageId2 = id;
  } else {
    messageId = id;
  }
  fs.writeFileSync(file, id);
}

// Fetch JSON
function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Fetch avec authentification (pour l'API NationsGlory)
function fetchWithAuth(url, apiKey) {
  return new Promise((resolve, reject) => {
    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      path: urlObj.pathname,
      method: 'GET',
      headers: {
        'accept': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      }
    };

    https.get(options, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try {
          resolve(JSON.parse(data));
        } catch (e) {
          reject(e);
        }
      });
    }).on('error', reject);
  });
}

// Discord request
function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      path,
      method,
      headers: { 'Content-Type': 'application/json' }
    };

    if (data) {
      const payload = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(options, res => {
      let body = '';
      res.on('data', c => body += c);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(body ? JSON.parse(body) : null);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${body}`));
        }
      });
    });

    req.on('error', reject);
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// Send / edit embed
async function sendOrEditMessage(embed, isSecond = false, pingEveryone = false) {
  try {
    const whId = isSecond ? webhookId2 : webhookId;
    const whToken = isSecond ? webhookToken2 : webhookToken;
    const msgId = isSecond ? messageId2 : messageId;
    
    const payload = { embeds: [embed] };
    if (pingEveryone) {
      payload.content = '@everyone';
    }

    if (msgId) {
      await makeRequest(
        'PATCH',
        `/api/webhooks/${whId}/${whToken}/messages/${msgId}`,
        payload
      );
    } else {
      const res = await makeRequest(
        'POST',
        `/api/webhooks/${whId}/${whToken}?wait=true`,
        payload
      );
      saveMessageId(res.id, isSecond ? MESSAGE_FILE_2 : MESSAGE_FILE, isSecond);
    }
  } catch (e) {
    if (isSecond) {
      messageId2 = null;
    } else {
      messageId = null;
    }
    console.error('❌ Erreur Discord:', e.message);
  }
}

// Self-ping pour Render
function selfPing() {
  if (!RENDER_URL) return;
  
  const url = RENDER_URL.startsWith('http') ? RENDER_URL : `https://${RENDER_URL}`;
  
  https.get(url, (res) => {
    console.log(`🔄 Self-ping: ${res.statusCode}`);
  }).on('error', (err) => {
    console.log(`⚠️ Self-ping échoué: ${err.message}`);
  });
}

// ==================== SCANNER 1 : WATCH LIST ====================
async function checkPlayers() {
  try {
    const data = await fetchJSON(DYNMAP_URL);

    const onlinePlayers = data.players.map(p => p.name);
    const totalOnline = data.currentcount || onlinePlayers.length;

    const watchedOnline = [];
    const watchedOffline = [];

    WATCH_LIST.forEach(p => {
      (onlinePlayers.includes(p) ? watchedOnline : watchedOffline).push(p);
    });

    // Temps IG
    const serverTime = data.servertime || 0;
    const hours = Math.floor(serverTime / 1000) % 24;
    const minutes = Math.floor((serverTime % 1000) / 1000 * 60);
    const timeIG = `${String(hours).padStart(2,'0')}:${String(minutes).padStart(2,'0')}:00`;

    const now = new Date();
    const timeStr = now.toLocaleTimeString('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    let statusText = '';
    if (watchedOnline.length) {
      statusText += `🟢 **En ligne (${watchedOnline.length}):**\n`;
      statusText += watchedOnline.map(p => `• ${p}`).join('\n');
    }
    if (watchedOffline.length) {
      if (statusText) statusText += '\n\n';
      statusText += `⚪ **Hors ligne (${watchedOffline.length}):**\n`;
      statusText += watchedOffline.map(p => `• ${p}`).join('\n');
    }

    const embed = {
      title: "🟢 RAPPORT TACTIQUE - LIME",
      color: watchedOnline.length ? 3066993 : 10197915,
      fields: [
        { name: "👥 Connectés Total", value: `**${totalOnline}**`, inline: true },
        { name: "🕐 Temps IG", value: `**${timeIG}**`, inline: true },
        { name: "⏱️ Dernier Relevé", value: `**${timeStr}**`, inline: true },
        { name: "👁️ Statut Surveillance", value: statusText || "Aucun joueur surveillé en ligne" }
      ],
      footer: { text: "Scanner automatique 24/7 • Actualisation toutes les 1s" },
      timestamp: new Date().toISOString()
    };

    await sendOrEditMessage(embed, false);
    console.log(`[${timeStr}] Scanner 1 OK - ${watchedOnline.length}/${WATCH_LIST.length}`);
  } catch (e) {
    console.error('❌ Erreur Scanner 1:', e.message);
  }
}

// ==================== SCANNER 2 : NATIONS ====================
async function checkNations() {
  try {
    const dynmapData = await fetchJSON(DYNMAP_URL);
    const onlinePlayers = dynmapData.players.map(p => p.name);

    const now = new Date();
    const timeStr = now.toLocaleTimeString('fr-FR', {
      timeZone: 'Europe/Paris',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });

    let nationsData = {};
    let totalOnline = 0;
    let assaultPossible = false;

    // Récupérer les données de chaque nation
    for (const nation of NATIONS_TO_WATCH) {
      try {
        const nationData = await fetchWithAuth(
          `https://publicapi.nationsglory.fr/country/lime/${nation}`,
          API_KEY
        );

        const members = nationData.members || [];
        const onlineMembers = members.filter(member => {
          const cleanName = member.replace(/^[*+-]/, '');
          return onlinePlayers.includes(cleanName);
        });

        nationsData[nation] = {
          name: nationData.name || nation,
          online: onlineMembers,
          count: onlineMembers.length
        };

        totalOnline += onlineMembers.length;

        // Vérifier si assaut possible (2+ joueurs)
        if (onlineMembers.length >= 2) {
          assaultPossible = true;
        }
      } catch (e) {
        console.error(`⚠️ Erreur récupération ${nation}:`, e.message);
        nationsData[nation] = {
          name: nation,
          online: [],
          count: 0
        };
      }
    }

    // Construire l'embed
    let statusText = '';
    
    for (const nation of NATIONS_TO_WATCH) {
      const data = nationsData[nation];
      const emoji = data.count >= 2 ? '🔴' : data.count === 1 ? '🟡' : '⚪';
      
      statusText += `${emoji} **${data.name.toUpperCase()}** : ${data.count} joueur${data.count > 1 ? 's' : ''} connecté${data.count > 1 ? 's' : ''}\n`;
      
      if (data.count > 0) {
        statusText += data.online.map(p => `• ${p.replace(/^[*+-]/, '')}`).join('\n') + '\n';
      }
      statusText += '\n';
    }

    if (assaultPossible) {
      statusText += '⚠️ **ASSAUT POSSIBLE** ⚠️\n';
    }

    const embed = {
      title: "⚔️ SURVEILLANCE NATIONS - LIME",
      color: assaultPossible ? 15158332 : totalOnline > 0 ? 16776960 : 10197915,
      fields: [
        { name: "👥 Total Connectés", value: `**${totalOnline}**`, inline: true },
        { name: "⏱️ Dernier Relevé", value: `**${timeStr}**`, inline: true },
        { name: "🎯 Nations Surveillées", value: `**${NATIONS_TO_WATCH.length}**`, inline: true },
        { name: "📊 Statut des Nations", value: statusText }
      ],
      footer: { text: "Scanner Nations 24/7 • Actualisation toutes les 1s" },
      timestamp: new Date().toISOString()
    };

    await sendOrEditMessage(embed, true, assaultPossible);
    console.log(`[${timeStr}] Scanner 2 OK - ${totalOnline} joueurs | Assaut: ${assaultPossible ? 'OUI' : 'NON'}`);
  } catch (e) {
    console.error('❌ Erreur Scanner 2:', e.message);
  }
}

// ==================== INITIALISATION ====================
parseWebhook(WEBHOOK_URL, false);
parseWebhook(WEBHOOK_URL_2, true);
loadMessageId(MESSAGE_FILE, false);
loadMessageId(MESSAGE_FILE_2, true);

// Lancer les scanners
checkPlayers();
checkNations();

setInterval(checkPlayers, CHECK_INTERVAL);
setInterval(checkNations, CHECK_INTERVAL);

// Self-ping toutes les 10 minutes
if (RENDER_URL) {
  console.log(`🔄 Self-ping activé vers: ${RENDER_URL}`);
  setInterval(selfPing, 600000);
}

// Keep alive server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('LIME Double Scanner running ✅');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log('📡 Scanner 1: Surveillance WATCH_LIST');
  console.log('⚔️ Scanner 2: Surveillance CoreeDuNord + Armenie');
});
