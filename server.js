const https = require('https');
const fs = require('fs');

// CONFIG - Variables d'environnement
const DYNMAP_URL = process.env.DYNMAP_URL || 'https://lime.nationsglory.fr/standalone/dynmap_world.json';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || '';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 1000; // 1 seconde
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

// Vérifier que le webhook est configuré
if (!WEBHOOK_URL) {
  console.error('❌ ERREUR: La variable DISCORD_WEBHOOK n\'est pas définie !');
  process.exit(1);
}

let messageId = null;
let webhookToken = null;
let webhookId = null;

// Extraire les infos du webhook
function parseWebhook() {
  const parts = WEBHOOK_URL.split('/');
  webhookId = parts[parts.length - 2];
  webhookToken = parts[parts.length - 1];
}

// Charger l'ID du message si existe
function loadMessageId() {
  try {
    if (fs.existsSync(MESSAGE_FILE)) {
      messageId = fs.readFileSync(MESSAGE_FILE, 'utf8').trim();
      console.log(`📝 Message ID chargé: ${messageId}`);
    }
  } catch (e) {
    console.log('Pas de message existant');
  }
}

// Sauvegarder l'ID du message
function saveMessageId(id) {
  messageId = id;
  fs.writeFileSync(MESSAGE_FILE, id);
}

function fetchJSON(url) {
  return new Promise((resolve, reject) => {
    https.get(url, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
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

function makeRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'discord.com',
      path: path,
      method: method,
      headers: {
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      const payload = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(options, (res) => {
      let responseData = '';
      res.on('data', chunk => responseData += chunk);
      res.on('end', () => {
        try {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(responseData ? JSON.parse(responseData) : null);
          } else {
            reject(new Error(`HTTP ${res.statusCode}: ${responseData}`));
          }
        } catch (e) {
          reject(e);
        }
      });
    });

    req.on('error', reject);
    if (data) {
      req.write(JSON.stringify(data));
    }
    req.end();
  });
}

async function sendOrEditMessage(embed) {
  try {
    if (messageId) {
      // EDIT le message existant
      await makeRequest(
        'PATCH',
        `/api/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`,
        { embeds: [embed] }
      );
      console.log('✏️  Message édité');
    } else {
      // CRÉER un nouveau message
      const response = await makeRequest(
        'POST',
        `/api/webhooks/${webhookId}/${webhookToken}?wait=true`,
        { embeds: [embed] }
      );
      saveMessageId(response.id);
      console.log(`📤 Nouveau message créé: ${response.id}`);
    }
  } catch (error) {
    // Si le message n'existe plus, recréer
    if (error.message.includes('404') || error.message.includes('Unknown Message')) {
      console.log('⚠️  Message introuvable, création d\'un nouveau...');
      messageId = null;
      const response = await makeRequest(
        'POST',
        `/api/webhooks/${webhookId}/${webhookToken}?wait=true`,
        { embeds: [embed] }
      );
      saveMessageId(response.id);
      console.log(`📤 Nouveau message créé: ${response.id}`);
    } else {
      throw error;
    }
  }
}

async function checkPlayers() {
  try {
    const data = await fetchJSON(DYNMAP_URL);
    const onlinePlayers = data.players.map(p => p.name);
    const totalOnline = data.currentcount || onlinePlayers.length;
    
    // Check qui de la watchlist est connecté
    const watchedOnline = [];
    const watchedOffline = [];
    
    WATCH_LIST.forEach(player => {
      if (onlinePlayers.includes(player)) {
        watchedOnline.push(player);
      } else {
        watchedOffline.push(player);
      }
    });

    // Temps IG
    const serverTime = data.servertime || 0;
    const hours = Math.floor(serverTime / 1000) % 24;
    const minutes = Math.floor((serverTime % 1000) / 1000 * 60);
    const timeIG = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:00`;
    
    const now = new Date();
    now.setHours(now.getHours() + 1);

    const timeStr = now.toLocaleTimeString('fr-FR');
  

    // Préparer le message Discord
    let statusText = '';
    if (watchedOnline.length > 0) {
      statusText += `🟢 **En ligne (${watchedOnline.length}):**\n`;
      statusText += watchedOnline.map(p => `• ${p}`).join('\n');
    }
    
    if (watchedOffline.length > 0) {
      if (statusText) statusText += '\n\n';
      statusText += `⚪ **Hors ligne (${watchedOffline.length}):**\n`;
      statusText += watchedOffline.map(p => `• ${p}`).join('\n');
    }

    const embed = {
      title: "🟢 RAPPORT TACTIQUE - LIME",
      color: watchedOnline.length > 0 ? 3066993 : 10197915,
      fields: [
        {
          name: "👥 Connectés Total",
          value: `**${totalOnline}**`,
          inline: true
        },
        {
          name: "🕐 Temps IG",
          value: `**${timeIG}**`,
          inline: true
        },
        {
          name: "⏱️ Dernier Relevé",
          value: `**${timeStr}**`,
          inline: true
        },
        {
          name: "👁️ Statut Surveillance",
          value: statusText || "Aucun joueur surveillé en ligne",
          inline: false
        }
      ],
      footer: {
        text: "Scanner automatique 24/7 • Actualisation toutes les 1s"
      },
      timestamp: now.toISOString()
    };

    await sendOrEditMessage(embed);
    console.log(`[${timeStr}] ✅ ${watchedOnline.length}/${WATCH_LIST.length} surveillés en ligne`);
    
  } catch (error) {
    console.error(`❌ Erreur:`, error.message);
  }
}

// Démarrage
parseWebhook();
loadMessageId();

console.log('🚀 LIME Scanner démarré');
console.log(`📋 Surveillance de ${WATCH_LIST.length} joueurs`);
console.log(`🔄 Check toutes les ${CHECK_INTERVAL/1000}s\n`);

// Premier check immédiat
checkPlayers();

// Check régulier
setInterval(checkPlayers, CHECK_INTERVAL);

// Keep alive pour Render
const http = require('http');
const server = http.createServer((req, res) => {
  res.writeHead(200);
  res.end('LIME Scanner is running');
});
server.listen(process.env.PORT || 3000);
console.log(`🌐 Health check sur port ${process.env.PORT || 3000}`);

