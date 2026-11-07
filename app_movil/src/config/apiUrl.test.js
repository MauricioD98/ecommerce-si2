// node --test src/config  (npm run test:config)
const test = require('node:test');
const assert = require('node:assert/strict');
const { parseApiBaseUrl } = require('./apiUrl');

const prod = { production: true };

test('URL de producción válida: se normaliza y agrega /api/v1 una sola vez', () => {
  assert.deepEqual(parseApiBaseUrl('https://api.example.com', prod), { ok: true, url: 'https://api.example.com/api/v1' });
  assert.deepEqual(parseApiBaseUrl(' https://API.example.com/api/v1/ ', prod), { ok: true, url: 'https://api.example.com/api/v1' });
  assert.deepEqual(parseApiBaseUrl('https://example.com/backend', prod), { ok: true, url: 'https://example.com/backend/api/v1' });
  assert.deepEqual(parseApiBaseUrl('https://api.example.com:8443/api/v1', prod), { ok: true, url: 'https://api.example.com:8443/api/v1' });
});

test('variable ausente o vacía', () => {
  for (const v of [undefined, '', '   ']) {
    const r = parseApiBaseUrl(v, prod);
    assert.equal(r.ok, false);
    assert.match(r.error, /vacía/);
  }
});

test('formato inválido', () => {
  for (const v of ['api.example.com', 'ftp://api.example.com', 'https://', 'https://api.example.com/api/v1?x=1',
    'https://user:pass@api.example.com', 'https://api example.com', 'https://api.example.com:99999']) {
    assert.equal(parseApiBaseUrl(v).ok, false, v);
  }
});

test('no permite /api/v1 duplicado ni endpoints en la base', () => {
  assert.equal(parseApiBaseUrl('https://api.example.com/api/v1/api/v1').ok, false);
  assert.equal(parseApiBaseUrl('https://api.example.com/api/v1/auth/login').ok, false);
});

test('producción rechaza http, localhost e IPs privadas', () => {
  for (const v of ['http://api.example.com/api/v1', 'https://localhost:3001', 'https://127.0.0.1/api/v1',
    'https://192.168.100.240:3001/api/v1', 'https://10.0.2.2:3001', 'https://172.20.1.5', 'https://mi-pc:3001',
    'https://servidor.local', 'https://[::1]:3001']) {
    const r = parseApiBaseUrl(v, prod);
    assert.equal(r.ok, false, v);
  }
  // 172.32.x.x ya no es rango privado
  assert.equal(parseApiBaseUrl('https://172.32.0.1', prod).ok, true);
});

test('desarrollo acepta la API local por http', () => {
  assert.deepEqual(parseApiBaseUrl('http://192.168.1.50:3001'), { ok: true, url: 'http://192.168.1.50:3001/api/v1' });
  assert.deepEqual(parseApiBaseUrl('http://10.0.2.2:3001/api/v1'), { ok: true, url: 'http://10.0.2.2:3001/api/v1' });
  assert.deepEqual(parseApiBaseUrl('http://localhost:3001/'), { ok: true, url: 'http://localhost:3001/api/v1' });
});
