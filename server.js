const https = require('https');
const fs = require('fs');
const http = require('http');

// ==================== CONFIG ====================
const DYNMAP_URL = process.env.DYNMAP_URL || 'https://lime.nationsglory.fr/standalone/dynmap_world.json';
const WEBHOOK_URL = process.env.DISCORD_WEBHOOK || '';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL) || 1000;
const MESSAGE_FILE = 'message_id.txt';
const STATS_FILE = 'player_stats.json';
const RENDER_URL = process.env.RENDER_EXTERNAL_URL || 'https://nationsglory-scanner2.onrender.com';

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

// ==================== VERIFICATION WEBHOOK ====================
if (!WEBHOOK_URL) {
  console.error('❌ ERREUR: DISCORD_WEBHOOK non défini');
  process.exit(1);
}

// ==================== VARIABLES ====================
let messageId = null;
let webhookId = null;
let webhookToken = null;
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
        totalTime: 0,
        connectionsByHour: Array(24).fill(0),
        connectionsByDay: Array(7).fill(0),
        lastSeen: null,
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
    stats.connectionsByHour[date.getHours()]++;
    stats.connectionsByDay[date.getDay()]++;
    console.log(`📥 ${player} connecté à ${date.getHours()}h`);
    
  } else if (!isOnline && stats.currentSession) {
    // Déconnexion
    const duration = now - stats.currentSession.start;
    stats.sessions.push({
      start: stats.currentSession.start,
      end: now,
      duration: duration,
      startHour: stats.currentSession.startHour,
      startDay: stats.currentSession.startDay
    });
    stats.totalTime += duration;
    stats.lastSeen = now;
    stats.currentSession = null;
    
    // Garder seulement les 100 dernières sessions
    if (stats.sessions.length > 100) {
      stats.sessions = stats.sessions.slice(-100);
    }
    
    console.log(`📤 ${player} déconnecté après ${formatDuration(duration)}`);
    saveStats();
  }
}

function formatDuration(ms) {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  if (hours > 0) return `${hours}h${minutes}m`;
  return `${minutes}m`;
}

function getAverageSessionTime(player) {
  const stats = playerStats[player];
  if (stats.sessions.length === 0) return 0;
  
  const total = stats.sessions.reduce((sum, s) => sum + s.duration, 0);
  return total / stats.sessions.length;
}

function getPeakHours(player) {
  const stats = playerStats[player];
  const counts = [...stats.connectionsByHour];
  
  // Trouver les 3 heures les plus fréquentes
  const peaks = counts
    .map((count, hour) => ({ hour, count }))
    .filter(x => x.count > 0)
    .sort((a, b) => b.count - a.count)
    .slice(0, 3);
  
  return peaks;
}

function predictNextConnection(player) {
  const stats = playerStats[player];
  const now = new Date();
  const currentHour = now.getHours();
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
    day: currentDay,
    hour: avgHour,
    confidence: Math.min(100, (todayStats.count / recentSessions.length) * 100)
  };
}

function getWeeklyTrend(player) {
  const stats = playerStats[player];
  const days = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam'];
  
  return stats.connectionsByDay
    .map((count, i) => `${days[i]}: ${count}`)
    .join(' | ');
}

function generateStatsEmbed(player) {
  const stats = playerStats[player];
  const avgSession = formatDuration(getAverageSessionTime(player));
  const totalTime = formatDuration(stats.totalTime);
  const peaks = getPeakHours(player);
  const prediction = predictNextConnection(player);
  
  let peaksText = peaks.length > 0 
    ? peaks.map(p => `${p.hour}h (${p.count}x)`).join(', ')
    : 'Pas assez de données';
  
  let predictionText = 'Calcul en cours...';
  if (prediction && stats.sessions.length >= 5) {
    const days = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
    const confidence = Math.round(prediction.confidence);
    predictionText = `${days[prediction.day]} vers ${prediction.hour}h (${confidence}% confiance)`;
  } else if (stats.sessions.length < 5) {
    predictionText = 'Minimum 5 sessions requises';
  }
  
  return {
    title: `📊 STATISTIQUES - ${player}`,
    color: 3447003,
    fields: [
      { name: "⏱️ Temps Total", value: totalTime, inline: true },
      { name: "📈 Moyenne/Session", value: avgSession, inline: true },
      { name: "🔢 Sessions Totales", value: `${stats.sessions.length}`, inline: true },
      { name: "🕐 Heures Favorites", value: peaksText, inline: false },
      { name: "📅 Activité Hebdo", value: getWeeklyTrend(player), inline: false },
      { name: "🔮 Prochaine Connexion", value: predictionText, inline: false }
    ],
    footer: { text: `Dernière activité: ${stats.lastSeen ? new Date(stats.lastSeen).toLocaleString('fr-FR') : 'Jamais'}` },
    timestamp: new Date().toISOString()
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
  try {
    await waitForRateLimit();
    await makeRequest(
      'POST',
      `/api/webhooks/${webhookId}/${webhookToken}`,
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
        const avgTime = formatDuration(getAverageSessionTime(p));
        statusText += `• ${p} (moy: ${avgTime})\n`;
      });
    }
    if (watchedOffline.length) {
      if (statusText) statusText += '\n';
      statusText += `⚪ **Hors ligne (${watchedOffline.length}):**\n`;
      watchedOffline.forEach(p => {
        const pred = predictNextConnection(p);
        const predText = pred ? `${pred.hour}h (${Math.round(pred.confidence)}%)` : 'N/A';
        statusText += `• ${p} (prévu: ${predText})\n`;
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
      footer: { text: "Scanner avec IA prédictive • Actualisation 1s • !stats [joueur] pour détails" },
      timestamp: new Date().toISOString()
    };

    await sendOrEditMessage(embed);
    console.log(`[${timeStr}] Scanner OK - ${watchedOnline.length}/${WATCH_LIST.length} en ligne`);
  } catch (e) {
    console.error('❌ Erreur Scanner:', e.message);
  }
}

// ==================== COMMANDES ====================

function handleCommand(message) {
  if (message.startsWith('!stats ')) {
    const player = message.substring(7).trim();
    if (WATCH_LIST.includes(player)) {
      const statsEmbed = generateStatsEmbed(player);
      sendAlert(statsEmbed);
    }
  }
}

// ==================== INITIALISATION ====================
parseWebhook(WEBHOOK_URL);
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
  res.end('LIME Scanner running ✅\nCommandes: !stats [joueur]');
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`🚀 Serveur démarré sur le port ${PORT}`);
  console.log('📡 Scanner: Surveillance WATCH_LIST avec IA prédictive');
  console.log(`👁️ ${WATCH_LIST.length} joueurs surveillés`);
  console.log('📊 Système de stats et prédictions activé');
});
