// Minimal Supabase stand-in: password auth (JWT) + /rest/v1 proxy to PostgREST.
import http from 'node:http';
import crypto from 'node:crypto';
const SECRET = 'local-test-secret-local-test-secret-123';
const USERS = { 'backup@example.com': '00000000-0000-0000-0000-0000000000cc' };
const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
const jwt = (sub) => { const h = b64({ alg: 'HS256', typ: 'JWT' }), p = b64({ sub, role: 'authenticated', exp: Math.floor(Date.now() / 1000) + 3600 });
  return `${h}.${p}.${crypto.createHmac('sha256', SECRET).update(`${h}.${p}`).digest('base64url')}`; };
http.createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    if (req.url.startsWith('/auth/v1/token')) {
      if (req.headers.apikey !== 'test-anon') { res.writeHead(401); return res.end('{"message":"no apikey"}'); }
      const { email, password } = JSON.parse(body || '{}');
      if (!USERS[email] || password !== 'pw') { res.writeHead(400); return res.end('{"error":"invalid_grant"}'); }
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ access_token: jwt(USERS[email]) }));
    }
    if (req.url.startsWith('/rest/v1/')) {
      const p = http.request({ host: 'localhost', port: 3001, path: req.url.slice(8), method: req.method,
        headers: { authorization: req.headers.authorization || '' } }, (pr) => { res.writeHead(pr.statusCode, pr.headers); pr.pipe(res); });
      p.end(body);
      return;
    }
    res.writeHead(404); res.end();
  });
}).listen(3002, () => console.log('proxy up'));
