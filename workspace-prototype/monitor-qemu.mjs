
import { createGuestApi } from './guest-api.mjs';
import path from 'node:path';

const api = createGuestApi({
  projectDirectory: process.cwd(),
  dataDirectory: path.join(process.cwd(), 'data')
});

const req = {
  method: 'POST',
  url: '/api/guest/start',
  socket: { remoteAddress: '127.0.0.1' },
  headers: { 'content-type': 'application/json' },
  [Symbol.asyncIterator]: async function* () {
    yield Buffer.from(JSON.stringify({ os: 'windows', bootMode: 'installer', cardId: 'windows' }));
  }
};

const res = {
  statusCode: 200,
  headers: {},
  writeHead(code, headers) {
    this.statusCode = code;
  },
  end(chunk) {
    console.log('STATUS:', this.statusCode);
  }
};

await api(req, res, () => {});
console.log('QEMU started. Staying alive for 15 seconds to monitor QEMU...');

let timer = 0;
const interval = setInterval(async () => {
  timer += 2;
  const statusReq = {
    method: 'GET',
    url: '/api/guest/status',
    socket: { remoteAddress: '127.0.0.1' },
    headers: {}
  };
  const statusRes = {
    writeHead() {},
    end(chunk) {
      const parsed = JSON.parse(chunk.toString());
      const winGuest = parsed.guests.find(g => g.os === 'windows' && g.cardId === 'windows');
      console.log();
      if (winGuest?.status === 'offline' || winGuest?.status === 'error') {
        clearInterval(interval);
        process.exit(0);
      }
    }
  };
  await api(statusReq, statusRes, () => {});
  if (timer >= 16) {
    clearInterval(interval);
    process.exit(0);
  }
}, 2000);
