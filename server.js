const https = require('https');
const fs = require('fs');
const http = require('http');

// ==================== CONFIG ====================
const DYNMAP_URL = process.env.DYNMAP_URL || 'https://lime.nationsglory.fr/standalone/dynmap_world.json';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || '';
const WEBHOOK_ALERT_URL = process.env.DISCORD_WEBHOOK_ALERT || ''; // Webhook pour les alertes co/deco
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 1000;
const MESSAGE_FILE = 'message_id.txt';
const STATS_FILE = 'player_stats.json';
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://nationsglory-scanner2.onrender.com';

// Liste des joueurs à surveiller
const WATCH_LIST = [
  'Canisi',
  'Darkholess',
  'UFO_Thespoot',
  'Franky753',
  'Blakonne',
  'Thepainx31x',
  'Farsgame',
  'ClashKiller78',
  'Olmat38',
  'AstaPatate'
];

// ==================== VERIFICATION WEBHOOK ====================
if (!WEBHOOK_URL) {
  console.error('❌ ERREUR: DISCORD_WEBHOOK non défini');
  process.exit(1);
}

if (!WEBHOOK_ALERT_URL) {
  console.warn('⚠️ ATTENTION: DISCORD_WEBHOOK_ALERT non défini, les alertes seront désactivées');
}

// ==================== VARIABLES ====================
let messageId = null;
let webhookId = null;
let webhookToken = null;
let webhookAlertId = null;
let webhookAlertToken = null;
let lastDiscordRequest = 0;
const DISCORD_DELAY = 500;
let playerStats = {};
let lastKnownState = {};

// ==================== GESTION DES STATS ====================

function loadStats() {
  if (fs.existsSync(STATS_FILE)) {
    try {
      playerStats = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
      console.log(`📊 Statistiques chargées pour ${Object.keys(playerStats).length} joueurs`);
    } catch (e) {
      console.error('⚠️ Erreur lecture stats:', e.message);
      playerStats = {};
    }
  }
  
  // Initialiser les stats pour nouveaux joueurs
  WATCH_LIST.forEach(p => {
    if (!playerStats[p]) {
      playerStats[p] = {
        sessions: [],
        currentSession: null
      };
    }
  });
}

function saveStats() {
  try {
    fs.writeFileSync(STATS_FILE, JSON.stringify(playerStats, null, 2));
  } catch (e) {
    console.error('⚠️ Erreur sauvegarde stats:', e.message);
  }
}

function updatePlayerStats(player, isOnline) {
  const now = Date.now();
  const stats = playerStats[player];
  
  if (isOnline && !stats.currentSession) {
    // Connexion
    const date = new Date();
    stats.currentSession = {
      start: now,
      startHour: date.getHours(),
      startDay: date.getDay()
    };
    console.log(`📥 ${player} connecté à ${date.getHours()}h`);
    
  } else if (!isOnline && stats.currentSession) {
    // Déconnexion
    const duration = now - stats.currentSession.start;
    stats.sessions.push({
      start: stats.currentSession.start,
      end: now,
      duration: duration,
      startHour: stats.currentSession.startHour,
      startDay: stats.currentSession.startDay,
      endHour: new Date(now).getHours(),
      endDay: new Date(now).getDay()
    });
    stats.currentSession = null;
    
    // Garder seulement les 100 dernières sessions
    if (stats.sessions.length > 100) {
      stats.sessions = stats.sessions.slice(-100);
    }
    
    console.log(`📤 ${player} déconnecté`);
    saveStats();
  }
}

function formatDuration(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

function predictNextConnection(player) {
  const stats = playerStats[player];
  const now = new Date();
  const currentDay = now.getDay();
  
  if (stats.sessions.length < 5) return null;
  
  // Sessions des 7 derniers jours
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentSessions = stats.sessions.filter(s => s.start > weekAgo);
  
  if (recentSessions.length === 0) return null;
  
  // Calculer la moyenne par jour de la semaine
  const dayStats = Array(7).fill(0).map(() => ({ count: 0, hours: [] }));
  
  recentSessions.forEach(s => {
    const day = new Date(s.start).getDay();
    const hour = new Date(s.start).getHours();
    dayStats[day].count++;
    dayStats[day].hours.push(hour);
  });
  
  // Prédiction pour aujourd'hui
  const todayStats = dayStats[currentDay];
  if (todayStats.count === 0) return null;
  
  // Heure moyenne de connexion pour ce jour
  const avgHour = Math.round(
    todayStats.hours.reduce((a, b) => a + b, 0) / todayStats.hours.length
  );
  
  return {
    hour: avgHour,
    confidence: Math.min(100, (todayStats.count / recentSessions.length) * 100)
  };
}

function predictDisconnection(player) {
  const stats = playerStats[player];
  
  if (!stats.currentSession || stats.sessions.length < 5) return null;
  
  // Sessions des 7 derniers jours
  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const recentSessions = stats.sessions.filter(s => s.start > weekAgo);
  
  if (recentSessions.length === 0) return null;
  
  const now = new Date();
  const currentHour = now.getHours();
  
  // Filtrer les sessions qui ont commencé à une heure similaire (+/- 2h)
  const similarSessions = recentSessions.filter(s => {
    const diff = Math.abs(s.startHour - currentHour);
    return diff <= 2 || diff >= 22; // Gère le passage minuit
  });
  
  if (similarSessions.length === 0) return null;
  
  // Durée moyenne des sessions similaires
  const avgDuration = similarSessions.reduce((sum, s) => sum + s.duration, 0) / similarSessions.length;
  
  // Temps écoulé depuis la connexion
  const elapsed = Date.now() - stats.currentSession.start;
  
  // Temps restant estimé
  const remaining = avgDuration - elapsed;
  
  if (remaining < 0) return null;
  
  const decoTime = new Date(Date.now() + remaining);
  
  return {
    hour: decoTime.getHours(),
    minute: decoTime.getMinutes(),
    confidence: Math.min(100, (similarSessions.length / recentSessions.length) * 100)
  };
}

// ==================== FONCTIONS DISCORD ====================

async function waitForRateLimit() {
  const now = Date.now();
  const diff = now - lastDiscordRequest;
  if (diff < DISCORD_DELAY) {
    await new Promise(resolve => setTimeout(resolve, DISCORD_DELAY - diff));
  }
  lastDiscordRequest = Date.now();
}

function parseWebhook(url) {
  const parts = url.split('/');
  webhookId = parts[parts.length - 2];
  webhookToken = parts[parts.length - 1];
}

function parseWebhookAlert(url) {
  const parts = url.split('/');
  webhookAlertId = parts[parts.length - 2];
  webhookAlertToken = parts[parts.length - 1];
}

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

async function sendOrEditMessage(embed) {
  try {
    await waitForRateLimit();
    
    const payload = { embeds: [embed] };

    if (messageId) {
      try {
        await makeRequest(
          'PATCH',
          `/api/webhooks/${webhookId}/${webhookToken}/messages/${messageId}`,
          payload
        );
      } catch (e) {
        console.log(`⚠️ Message ${messageId} introuvable, création d'un nouveau...`);
        messageId = null;
        
        await waitForRateLimit();
        const res = await makeRequest(
          'POST',
          `/api/webhooks/${webhookId}/${webhookToken}?wait=true`,
          payload
        );
        saveMessageId(res.id);
      }
    } else {
      const res = await makeRequest(
        'POST',
        `/api/webhooks/${webhookId}/${webhookToken}?wait=true`,
        payload
      );
      saveMessageId(res.id);
    }
  } catch (e) {
    console.error('❌ Erreur Discord:', e.message);
  }
}

async function sendAlert(embed) {
  if (!WEBHOOK_ALERT_URL) {
    console.log('⚠️ Webhook alerte non configurée, alerte ignorée');
    return;
  }
  
  try {
    await waitForRateLimit();
    await makeRequest(
      'POST',
      `/api/webhooks/${webhookAlertId}/${webhookAlertToken}`,
      { embeds: [embed] }
    );
  } catch (e) {
    console.error('❌ Erreur alerte:', e.message);
  }
}

function selfPing() {
  if (!RENDER_URL) return;
  
  const url = RENDER_URL.startsWith('http') ? RENDER_URL : `https://${RENDER_URL}`;
  
  https.get(url, (res) => {
    console.log(`🔄 Self-ping: ${res.statusCode}`);
  }).on('error', (err) => {
    console.log(`⚠️ Self-ping échoué: ${err.message}`);
  });
}

// ==================== SCANNER ====================
async function checkPlayers() {
  try {
    const data = await fetchJSON(DYNMAP_URL);

    const onlinePlayers = data.players.map(p => p.name);
    const totalOnline = data.currentcount || onlinePlayers.length;

    const watchedOnline = [];
    const watchedOffline = [];

    WATCH_LIST.forEach(p => {
      const isOnline = onlinePlayers.includes(p);
      
      // Mettre à jour les stats
      if (lastKnownState[p] !== undefined) {
        if (isOnline !== lastKnownState[p]) {
          updatePlayerStats(p, isOnline);
          
          // Envoyer une alerte de connexion/déconnexion
          const alertEmbed = {
            title: isOnline ? "🟢 CONNEXION DÉTECTÉE" : "🔴 DÉCONNEXION",
            description: `**${p}** ${isOnline ? 'vient de se connecter' : 'vient de se déconnecter'}`,
            color: isOnline ? 3066993 : 15158332,
            timestamp: new Date().toISOString()
          };
          sendAlert(alertEmbed);
        }
      }
      
      lastKnownState[p] = isOnline;
      (isOnline ? watchedOnline : watchedOffline).push(p);
    });

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
      watchedOnline.forEach(p => {
        statusText += `• ${p}\n`;
      });
    }
    if (watchedOffline.length) {
      if (statusText) statusText += '\n';
      statusText += `⚪ **Hors ligne (${watchedOffline.length}):**\n`;
      watchedOffline.forEach(p => {
        statusText += `• ${p}\n`;
      });
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
      footer: { text: "Scanner en temps réel • Actualisation 1s" },
      timestamp: new Date().toISOString()
    };

    await sendOrEditMessage(embed);
    console.log(`[${timeStr}] Scanner OK - ${watchedOnline.length}/${WATCH_LIST.length} en ligne`);
  } catch (e) {
    console.error('❌ Erreur Scanner:', e.message);
  }
}

// ==================== INITIALISATION ====================
parseWebhook(WEBHOOK_URL);
if (WEBHOOK_ALERT_URL) {
  parseWebhookAlert(WEBHOOK_ALERT_URL);
  console.log('✅ Webhook alerte configurée');
}
loadMessageId();
loadStats();

// Lancer le scanner
checkPlayers();
setInterval(checkPlayers, CHECK_INTERVAL);

// Sauvegarde auto des stats toutes les 5 minutes
setInterval(saveStats, 300000);

// Self-ping toutes les 10 minutes
if (RENDER_URL) {
  console.log(`🔄 Self-ping activé vers: ${RENDER_URL}`);
  setInterval(selfPing, 600000);
}

// Keep alive server
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('LIME Scanner running ✅');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log('📡 Scanner: Surveillance WATCH_LIST en temps réel');
  console.log(`👁️ ${WATCH_LIST.length} joueurs surveillés`);
});
