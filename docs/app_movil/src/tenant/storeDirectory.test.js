// Pruebas del directorio de tiendas del login.
//   node --test src/tenant/storeDirectory.test.js
const test = require('node:test');
const assert = require('node:assert/strict');
const dir = require('./storeDirectory');

const API = 'http://localhost:3001/api/v1';
const RAW = [
  { id: '5EF12838-EC40-47F1-AC6C-64BE0EE2D880', slug: 'stella-demo', name: 'Stella Femme Demo', planName: 'Pro', mobileApp: true, logoUrl: '/platform/tenants/5ef12838-ec40-47f1-ac6c-64be0ee2d880/logo' },
  { id: '6cf85be5-8a14-4903-a744-9c97303dee4f', slug: 'starter-demo', name: 'Tienda Starter', planName: 'Starter', mobileApp: false, logoUrl: null },
  { id: '11111111-1111-4111-8111-111111111111', slug: 'moda-andina', name: 'Moda Andina Estética', planName: 'Pro', mobileApp: true, logoUrl: 'https://cdn.example.com/logo.png' },
  { id: 'no-es-uuid', name: 'Rota' },
  { id: '11111111-1111-4111-8111-111111111111', name: 'Duplicada' },
  null,
];

test('toStores: valida, normaliza ids, quita duplicados y arma la URL del logo', () => {
  const stores = dir.toStores(RAW, API);
  assert.equal(stores.length, 3);
  assert.equal(stores[0].id, '5ef12838-ec40-47f1-ac6c-64be0ee2d880', 'id en minúsculas, como x-tenant-id');
  assert.equal(stores[0].logoUrl, `${API}/platform/tenants/5ef12838-ec40-47f1-ac6c-64be0ee2d880/logo`);
  assert.equal(stores[1].logoUrl, null);
  assert.equal(stores[1].mobileApp, false);
  assert.equal(stores[2].logoUrl, 'https://cdn.example.com/logo.png');
  assert.deepEqual(dir.toStores(null, API), []);
});

test('resolveLogoUrl: solo https externa o ruta de la API', () => {
  assert.equal(dir.resolveLogoUrl('http://inseguro/logo.png', API), null);
  assert.equal(dir.resolveLogoUrl('javascript:alert(1)', API), null);
  assert.equal(dir.resolveLogoUrl('/platform/tenants/x/logo', `${API}/`), `${API}/platform/tenants/x/logo`);
  assert.equal(dir.resolveLogoUrl('/platform/tenants/x/logo', null), null);
});

test('searchStores: por nombre visible, sin tildes ni mayúsculas; las sin app al final', () => {
  const stores = dir.toStores(RAW, API);
  assert.deepEqual(dir.searchStores(stores, 'stella').map((s) => s.slug), ['stella-demo']);
  assert.deepEqual(dir.searchStores(stores, 'ESTETICA').map((s) => s.slug), ['moda-andina'], 'sin tildes');
  assert.deepEqual(dir.searchStores(stores, 'femme').map((s) => s.slug), ['stella-demo'], 'palabra intermedia');
  assert.deepEqual(dir.searchStores(stores, 'starter-demo').map((s) => s.slug), ['starter-demo'], 'también por identificador');
  assert.deepEqual(dir.searchStores(stores, 'zzz'), []);
  assert.deepEqual(
    dir.searchStores(stores, '').map((s) => s.slug),
    ['moda-andina', 'stella-demo', 'starter-demo'],
    'sin búsqueda: todas, alfabético, la que no tiene app al final'
  );
});

test('storeInitials y errores del directorio', () => {
  assert.equal(dir.storeInitials('Stella Femme Demo'), 'SF');
  assert.equal(dir.storeInitials('moda'), 'M');
  assert.equal(dir.storeInitials(''), '?');
  assert.equal(dir.classifyDirectoryError({ online: false }), 'offline');
  assert.equal(dir.classifyDirectoryError({ online: true }), 'network');
  assert.equal(dir.classifyDirectoryError({ online: true, status: 500 }), 'server');
});
