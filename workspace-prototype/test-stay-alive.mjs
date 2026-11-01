
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
  writeHead() {},
  end() {}
};

await api(req, res, () => {});
console.log('Started. Now checking every 2 seconds for 20 seconds...');

for (let i = 1; i <= 10; i++) {
  await new Promise(r => setTimeout(r, 2000));
  const sReq = { method: 'GET', url: '/api/guest/status', socket: { remoteAddress: '127.0.0.1' }, headers: {} };
  const sRes = {
    writeHead() {},
    end(chunk) {
      const g = JSON.parse(chunk.toString()).guests.find(x => x.cardId === 'windows');
      console.log('Tick', i, 'phase:', g?.status, 'error:', g?.error);
    }
  };
  await api(sReq, sRes, () => {});
}
process.exit(0);
