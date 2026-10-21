const { test } = require('node:test');
const assert = require('node:assert/strict');
const { httpConfig } = require('../src/http-config');
test('proxy configuration defaults off and accepts explicit IPv4/IPv6 addresses and CIDRs', () => {
  assert.deepEqual(httpConfig(), { trustProxy: false, origin: null });
  assert.deepEqual(httpConfig({ trustedProxies: '127.0.0.1, ::1, 10.2.0.0/24, fd00::/64', publicOrigin: 'https://arena.example/', secureCookies: true }), {
    trustProxy: ['127.0.0.1', '::1', '10.2.0.0/24', 'fd00::/64'], origin: 'https://arena.example'
  });
});
test('proxy configuration rejects trust-all, hop counts and invalid origins before startup', () => {
  for (const trustedProxies of ['true', '1', 'loopback', '0.0.0.0/0', '::/0', '127.0.0.1/33', '::1/129', '127.0.0.1,', 'not-an-ip', true]) {
    assert.throws(() => httpConfig({ trustedProxies, publicOrigin: 'http://arena.example' }));
  }
  assert.throws(() => httpConfig({ trustedProxies: '127.0.0.1' }), /PUBLIC_ORIGIN/);
  for (const publicOrigin of ['bad', 'ftp://arena.example', 'https://user:pass@arena.example', 'https://arena.example/path', 'https://arena.example/?x=1', 'https://arena.example/#x']) {
    assert.throws(() => httpConfig({ publicOrigin, secureCookies: true }));
  }
  assert.throws(() => httpConfig({ publicOrigin: 'https://arena.example' }), /COOKIE_SECURE/);
});
