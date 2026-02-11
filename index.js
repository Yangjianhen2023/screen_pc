const { screen, BrowserWindow, app, Tray, Menu } = require('electron');
const WebSocket = require('ws');
const getLocalIPv4 = require('./getLocalIP');
const os = require('os');
const { machineId } = require('node-machine-id');
const path = require('path')

const computerName = os.hostname();
const ip = getLocalIPv4();
const MAIN_SERVER = 'ws://' + ip + ':3000';

let computerId;
let displayWindows = new Map();
let tray = null

async function init() {
  computerId = await machineId();

  connect(); 
}

function connect() {
  console.log('Connecting to main app...');

  const ws = new WebSocket(MAIN_SERVER);

  ws.on('open', () => {
    console.log('✅ Connected to main app');
    const displays = screen.getAllDisplays();

    ws.send(JSON.stringify({
      type: 'REGISTER',
      deviceId: computerId,
      deviceName: computerName,
      displays: displays  
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

  if (msg.type === 'OPEN_SCREEN') {
    console.log("open screen")
    openDisplayWindow(msg.displayId, msg.url)
  }
}

const openDisplayWindow = (displayId, url) => {
  const displays = screen.getAllDisplays();
  const display = displays.find(d => d.id == displayId);

  if (!display) {
    console.log("Display not found:", displayId);
    return;
  }

  let win = displayWindows.get(displayId);

  // If the window exists → directly replace the URL
  if (win && !win.isDestroyed()) {
    console.log("Reload display window:", displayId);
    win.loadURL(url);
    return;
  }

  // Not found → create new
  console.log("Create display window:", displayId);

  win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    fullscreen: true,
    frame: false
  });

  win.loadURL(url);

  displayWindows.set(displayId, win);

  win.on('closed', () => {
    displayWindows.delete(displayId);
  });
};

app.whenReady().then(() => {
  tray = new Tray(path.join(__dirname, 'fire.png'))

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setToolTip('Fire Alarm Display')
  tray.setContextMenu(contextMenu)
})

init();