import test from 'node:test';
import assert from 'node:assert/strict';
import { createAdminAuth } from '../src/auth.js';

const secret = 'segredo-de-teste-com-pelo-menos-trinta-e-dois-bytes';

test('autenticação administrativa valida a credencial e emite JWT limitado ao admin', async () => {
  let timestamp = Date.parse('2026-07-17T12:00:00Z');
  const auth = await createAdminAuth({ username: 'Admin@Empresa.com', password: 'senha-segura', secret, ttlSeconds: 60, now: () => timestamp });
  assert.equal(await auth.verifyCredentials('admin@empresa.com', 'senha-segura'), true);
  assert.equal(await auth.verifyCredentials('admin@empresa.com', 'incorreta'), false);
  assert.equal(await auth.verifyCredentials('outro@empresa.com', 'senha-segura'), false);

  const token = auth.issueToken();
  assert.equal(auth.verifyToken(token).sub, 'admin@empresa.com');
  assert.equal(auth.verifyToken(token).role, 'admin');
  assert.equal(auth.verifyToken(`${token}alterado`), null);
  timestamp += 61_000;
  assert.equal(auth.verifyToken(token), null);
});

test('sessão aceita cookie ou Bearer e pode ser revogada', async () => {
  const auth = await createAdminAuth({ username: 'admin@example.com', password: 'senha-segura', secret });
  const token = auth.issueToken();
  assert.equal(auth.session({ headers: { cookie: `outro=1; cbm_admin_session=${token}` } }).role, 'admin');
  assert.equal(auth.session({ headers: { authorization: `Bearer ${token}` } }).role, 'admin');
  assert.match(auth.sessionCookie(token, true), /Path=\/admin; HttpOnly; SameSite=Strict; Max-Age=28800; Secure/);
  auth.revoke(token);
  assert.equal(auth.verifyToken(token), null);
});
