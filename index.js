const { screen, BrowserWindow, app, Tray, Menu, session } = require('electron');
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
    openDisplayWindow(msg.displayId, msg.url, msg.ses)
  }

  if (msg.type === 'LOGIN_WEB') {
    log.info("login web")
    loginWeb(msg.displayId, msg.acc, msg.password)
  }

  if (msg.type === 'OTP_LOGIN') {
    log.info("otp login")
    otpLogin()
  }

  if (msg.type === 'CLOSE_SCREEN') {
    log.info("close screen")
    closeDisplayWindow(msg.displayId, msg.url, msg.returnDisplayId)
  }
}

const openDisplayWindow = async (displayId, url, token) => {
  const ses = session.defaultSession;

  for (const c of token) {
    await ses.cookies.set({
      url: url,
      name: c.name,
      value: c.value,
      domain: c.domain,
      path: c.path,
      secure: c.secure,
      httpOnly: c.httpOnly,
      sameSite: c.sameSite,
      expirationDate: c.exiprationDate
    });
  }
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

const closeDisplayWindow = async (displayId, url, returnDisplayId) => {
  const displays = screen.getAllDisplays();
  const display = displays.find(d => d.id == displayId);

  if (!display) {
    log.info("Display not found:", displayId);
    return;
  }

  let win = displayWindows.get(displayId);
  const cookies = await session.defaultSession.cookies.get({ url });

  ws.send(JSON.stringify({
    type: 'CLOSE_SCREEN_SESSION_RETURN',
    ses: cookies,
    url: url,
    displayId: returnDisplayId
  }));
  win.close();
} 

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
      const loginBtn = Array.from(document.querySelectorAll('button[type="submit"], input[type="submit"], button'))
        .find(btn => {
          const text = btn.innerText || btn.value || "";
          return /sign in|log in|login/i.test(text.trim());
        });

      function setNativeValue(element, value) {
        const valueSetter = Object.getOwnPropertyDescriptor(element.__proto__, 'value').set;
        valueSetter.call(element, value);
        element.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (userInput) setNativeValue(userInput, ${JSON.stringify(acc)});
      if (passInput) setNativeValue(passInput, ${JSON.stringify(password)});
      if (loginBtn) loginBtn.click();
    })();
  `);
};

const otpLogin = (displayId, otp) => {
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

      const otpInput = document.querySelector('input[name="otp_attempt"]');
      const submitBtn = document.querySelector(
        'button[type="submit"], input[type="submit"], button'
      );

      if (otpInput) {
        otpInput.value = ${JSON.stringify(otp)};
        otpInput.dispatchEvent(new Event('input', { bubbles: true }));
      }

      if (submitBtn) {
        submitBtn.click();
      }

    })();
  `);
}


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