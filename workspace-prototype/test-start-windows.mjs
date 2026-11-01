
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
    this.headers = headers;
  },
  end(chunk) {
    console.log('STATUS_CODE:', this.statusCode);
    if (chunk) console.log('RESPONSE:', chunk.toString());
  }
};

await api(req, res, (err) => {
  if (err) console.error('MIDDLEWARE_ERR:', err);
});
process.exit(0);
