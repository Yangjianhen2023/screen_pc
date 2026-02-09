const os = require('os');

function getBestLocalIPv4() {
  const nets = os.networkInterfaces();

  const candidates = [];

  for (const name of Object.keys(nets)) {
    for (const net of nets[name]) {

      if (net.family !== 'IPv4') continue;
      if (net.internal) continue;

      candidates.push(net.address);
    }
  }

  if (!candidates.length) return null;

  candidates.sort((a, b) => getPriority(a) - getPriority(b));

  return candidates[0];
}

function getPriority(ip) {
  if (ip.startsWith('192.168.')) return 1;
  if (ip.startsWith('10.')) return 2;
  if (ip.startsWith('172.')) return 3;
  if (ip.startsWith('100.')) return 4;
  return 99;
}

module.exports = getBestLocalIPv4;