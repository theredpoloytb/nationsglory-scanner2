const https = require('https');
const fs = require('fs');
const http = require('http');

// CONFIG
const DYNMAP_URL = process.env.DYNMAP_URL || 'https://lime.nationsglory.fr/standalone/dynmap_world.json';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || '';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 1000;
const MESSAGE_FILE = 'message_id.txt';

// Liste des joueurs à surveiller
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

if (!WEBHOOK_URL) {
  console.error('❌ ERREUR: DISCORD_WEBHOOK non défini');
  process.exit(1);
}

let messageId = null;
let webhookId = null;
let webhookToken = null;

// Webhook parse
function parseWebhook() {
  const parts = WEBHOOK_URL.split('/');
  webhookId = parts[parts.length - 2];
  webhookToken = parts[parts.length - 1];
}

// Message ID
function loadMessageId() {
  if (fs.existsSync(MESSAGE_FILE)) {
    messageId = fs.readFileSync(MESSAGE_FILE, 'utf8').trim();
    console.log(`📝 Message ID chargé: ${messageId}`);
  }
}

function saveMessageId(id) {
  messageId = id;
  fs.writeFileSync(MESSAGE_FILE, id);
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
async function sendOrEditMessage(embed) {
  try {
    if (messageId) {
      await makeRequest(
        'PATCH',
        `/api/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`,
        { embeds: [embed] }
      );
    } else {
      const res = await makeRequest(
        'POST',
        `/api/webhooks/${webhookId}/${webhookToken}?wait=true`,
        { embeds: [embed] }
      );
      saveMessageId(res.id);
    }
  } catch {
    messageId = null;
  }
}

// MAIN
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

    // 🔥 HEURE CORRIGÉE
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
      timestamp: new Date().toISOString() // UTC OK pour Discord
    };

    await sendOrEditMessage(embed);
    console.log(`[${timeStr}] OK ${watchedOnline.length}/${WATCH_LIST.length}`);
  } catch (e) {
    console.error('❌ Erreur:', e.message);
  }
}

// INIT
parseWebhook();
loadMessageId();

checkPlayers();
setInterval(checkPlayers, CHECK_INTERVAL);

// Keep alive
const server = http.createServer((_, res) => {
  res.writeHead(200);
  res.end('LIME Scanner running');
});
server.listen(process.env.PORT || 3000);
