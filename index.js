const { screen, BrowserWindow, app, Tray, Menu } = require('electron');
const WebSocket = require('ws');
const getLocalIPv4 = require('./getLocalIP');
const os = require('os');
const { machineId } = require('node-machine-id');
const path = require('path')
let log = require('electron-log');
const isDev = !app.isPackaged;

const logsPath = isDev
  ? log.transports.file.resolvePath = () => __dirname + '/logs/log.log'
  : log.transports.file.resolvePath = () => path.join(app.getPath('userData'), 'logs/main.log');

log.transports.file.level = 'info';

const computerName = os.hostname();
const ip = getLocalIPv4();
const MAIN_SERVER = 'ws://192.168.50.10:3000';
// const MAIN_SERVER = 'ws://' + ip + ':3000';

let computerId;
let displayWindows = new Map();
let displayUrlMap = new Map();
let tray = null
let ws

async function init() {
  computerId = await machineId();

  connect(); 
}

function connect() {
  log.log('Connecting to main app...');

  ws = new WebSocket(MAIN_SERVER);

  ws.on('open', () => {
    log.info('✅ Connected to main app');
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
    log.info('❌ Disconnected, retrying...');
    setTimeout(connect, 3000);
  });

  ws.on('error', (err) => {
    log.info('Socket error:', err.message);
  });
}

function handleCommand(msg) {
  log.info('📩 Received:', msg);

  if (msg.type === 'OPEN_SCREEN') {
    log.info("open screen")
    openDisplayWindow(msg.displayId, msg.url)
  }

  if (msg.type === 'LOGIN_WEB') {
    log.info("login web")
    loginWeb(msg.displayId, msg.acc, msg.password)
  }
}

const openDisplayWindow = (displayId, url) => {
  const displays = screen.getAllDisplays();
  const display = displays.find(d => d.id == displayId);

  if (!display) {
    log.info("Display not found:", displayId);
    return;
  }

  let win = displayWindows.get(displayId);

  // If the window exists → directly replace the URL
  if (win && !win.isDestroyed()) {
    log.info("Reload display window:", displayId);
    win.loadURL(url);
    displayUrlMap.set(displayId, url);

    ws.send(JSON.stringify({
      type: 'OPEN_SCREEN_RETURN',
      remoteDisplayUrlMap: Object.fromEntries(displayUrlMap)
    }));
    return;
  }

  // Not found → create new
  log.info("Create display window:", displayId);

  win = new BrowserWindow({
    x: display.bounds.x,
    y: display.bounds.y,
    fullscreen: true,
    frame: false
  });

  win.loadURL(url);

  const memoryMonitor = setInterval(async () => {

    if (win.isDestroyed()) {
      clearInterval(memoryMonitor);
      return;
    }

    try {
      const mem = await process.getProcessMemoryInfo();

      const memoryMB = Math.round(mem.private / 1024);
      log.info(`Window ${win.id} Memory: ${memoryMB} MB`);

      if (memoryMB > 400) {
        log.info("Memory usage too high, refresh command executed");
        win.webContents.reloadIgnoringCache()
      }

    } catch (err) {
      log.error("Memory check error:", err);
    }

  }, 3000);

  displayWindows.set(displayId, win);
  displayUrlMap.set(displayId, url);  

  ws.send(JSON.stringify({
    type: 'OPEN_SCREEN_RETURN',
    remoteDisplayUrlMap: Object.fromEntries(displayUrlMap)
  }));

  win.on('closed', () => {
    displayWindows.delete(displayId);
    displayUrlMap.delete(displayId);
    ws.send(JSON.stringify({
      type: 'OPEN_SCREEN_RETURN',
      remoteDisplayUrlMap: Object.fromEntries(displayUrlMap)
    }));

  });

  win.webContents.on('unresponsive', () => {
    log.info(`Window ${win.id} The page is unresponsive (frozen)`);
  });

  win.webContents.on('responsive', () => {
    log.info(`Window ${win.id} Recovery response`);
  });
};

const loginWeb = (displayId, acc, password) => {
  console.log(displayId, acc, password)
  const displays = screen.getAllDisplays();
  const display = displays.find(d => d.id == displayId);

  if (!display) {
    log.info("Display not found:", displayId);
    return;
  }

  let win = displayWindows.get(displayId);

  // Injecting JavaScript code into a web form
  win.webContents.executeJavaScript(`
    (function() {
      // Try common username/password input fields and login buttons.
      const userInput = document.querySelector(
        'input[type="text"], input[type="email"], input[name*="user"], input[id*="user"]'
      );
      const passInput = document.querySelector(
        'input[type="password"], input[name*="password"], input[id*="pass"]'
      );
      const loginBtn = document.querySelector(
        'button[type="submit"], input[type="submit"], button, input.login-btn'
      );

      if(userInput) userInput.value = ${JSON.stringify(acc)};
      if(passInput) passInput.value = ${JSON.stringify(password)};
      if(loginBtn) loginBtn.click();
    })();
  `);
};

app.whenReady().then(() => {
  tray = new Tray(path.join(__dirname, 'fire.png'))

  const contextMenu = Menu.buildFromTemplate([
    { label: 'Quit', click: () => app.quit() }
  ])

  tray.setToolTip('Fire Alarm Display')
  tray.setContextMenu(contextMenu)
})

app.on('window-all-closed', (e) => {
  e.preventDefault()
})

init();