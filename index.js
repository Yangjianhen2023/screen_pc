const WebSocket = require('ws');
const getLocalIPv4 = require('./getLocalIP');

const ip = getLocalIPv4();
const MAIN_SERVER = 'ws://' + ip + ':3000';

function connect() {
  console.log('Connecting to main app...');

  const ws = new WebSocket(MAIN_SERVER);

  ws.on('open', () => {
    console.log('✅ Connected to main app');

    ws.send(JSON.stringify({
      type: 'REGISTER',
      deviceId: 'player-001'
    }));
  });

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString());
    handleCommand(msg);
  });

  ws.on('close', () => {
    console.log('❌ Disconnected, retrying...');
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    console.log('Socket error:', err.message);
  });
}

function handleCommand(msg) {
  console.log('📩 Received:', msg);

  if (msg.type === 'TEST') {
    console.log('🔥 TEST COMMAND:', msg.payload);
  }
}

connect();