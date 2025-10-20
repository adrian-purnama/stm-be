const { WebSocketServer } = require('ws');
const { notificationsEvents } = require('../utils/notificationHelper');
const Notification = require('../models/notification.model');

function setupNotificationWebsocket(server) {
  const wss = new WebSocketServer({ server, path: '/notification' });

  const HEARTBEAT_MS = 30000;
  function heartbeat() { this.isAlive = true; }

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', heartbeat);
    ws.send(JSON.stringify({ type: 'status', message: 'connected' }));
  });

  const interval = setInterval(() => {
    wss.clients.forEach((ws) => {
      if (ws.isAlive === false) return ws.terminate();
      ws.isAlive = false;
      ws.ping();
    });
  }, HEARTBEAT_MS);

  wss.on('close', () => clearInterval(interval));

  notificationsEvents.on('created', (payload) => {
    const message = JSON.stringify({ type: 'notification', payload });
    wss.clients.forEach((client) => {
      if (client.readyState === client.OPEN) {
        client.send(message);
      }
    });
  });

  // Note: Event-based broadcasting via notificationsEvents is sufficient
  // MongoDB change streams are disabled to prevent duplicate notifications

  return wss;
}

module.exports = { setupNotificationWebsocket };
