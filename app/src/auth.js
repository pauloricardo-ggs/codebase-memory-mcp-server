import { createHash, createHmac, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';

const scryptAsync = promisify(scrypt);
const encoder = value => Buffer.from(JSON.stringify(value)).toString('base64url');

function decode(value) {
  try { return JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch { return null; }
}

function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(item => item.trim()).filter(Boolean).map(item => {
    const separator = item.indexOf('=');
    if (separator < 0) return [item, ''];
    return [item.slice(0, separator), decodeURIComponent(item.slice(separator + 1))];
  }));
}

export async function createAdminAuth({ username, password, secret, ttlSeconds = 28_800, now = () => Date.now() }) {
  if (!username || !password) throw new Error('Credencial administrativa não configurada.');
  if (!secret || Buffer.byteLength(secret) < 32) throw new Error('Segredo JWT administrativo inválido.');

  const normalizedUsername = String(username).trim().toLowerCase();
  const salt = randomBytes(16);
  const passwordHash = await scryptAsync(String(password), salt, 32);
  const revoked = new Map();

  function signature(value) {
    return createHmac('sha256', secret).update(value).digest('base64url');
  }

  function issueToken() {
    const issuedAt = Math.floor(now() / 1000);
    const header = encoder({ alg: 'HS256', typ: 'JWT' });
    const payload = encoder({
      sub: normalizedUsername,
      role: 'admin',
      iss: 'codebase-memory-admin',
      aud: 'codebase-memory-admin',
      iat: issuedAt,
      exp: issuedAt + ttlSeconds,
      jti: randomUUID()
    });
    const content = `${header}.${payload}`;
    return `${content}.${signature(content)}`;
  }

  function verifyToken(token) {
    if (typeof token !== 'string') return null;
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const content = `${parts[0]}.${parts[1]}`;
    const expected = Buffer.from(signature(content));
    const received = Buffer.from(parts[2]);
    if (expected.length !== received.length || !timingSafeEqual(expected, received)) return null;
    const payload = decode(parts[1]);
    const current = Math.floor(now() / 1000);
    if (!payload || payload.sub !== normalizedUsername || payload.role !== 'admin' ||
      payload.iss !== 'codebase-memory-admin' || payload.aud !== 'codebase-memory-admin' ||
      !Number.isInteger(payload.exp) || payload.exp <= current || revoked.has(payload.jti)) return null;
    return payload;
  }

  function tokenFromRequest(request) {
    const authorization = request.headers.authorization || '';
    if (authorization.startsWith('Bearer ')) return authorization.slice(7).trim();
    return parseCookies(request.headers.cookie).cbm_admin_session || '';
  }

  async function verifyCredentials(candidateUsername, candidatePassword) {
    const candidate = String(candidateUsername || '').trim().toLowerCase();
    const candidateHash = await scryptAsync(String(candidatePassword || ''), salt, 32);
    const passwordMatches = timingSafeEqual(passwordHash, candidateHash);
    const left = createHash('sha256').update(candidate).digest();
    const right = createHash('sha256').update(normalizedUsername).digest();
    return timingSafeEqual(left, right) && passwordMatches;
  }

  function revoke(token) {
    const payload = verifyToken(token);
    if (payload) revoked.set(payload.jti, payload.exp);
    const current = Math.floor(now() / 1000);
    for (const [jti, expiration] of revoked) if (expiration <= current) revoked.delete(jti);
  }

  function session(request) {
    return verifyToken(tokenFromRequest(request));
  }

  function sessionCookie(token, secure = false) {
    return `cbm_admin_session=${encodeURIComponent(token)}; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=${ttlSeconds}${secure ? '; Secure' : ''}`;
  }

  function clearCookie(secure = false) {
    return `cbm_admin_session=; Path=/admin; HttpOnly; SameSite=Strict; Max-Age=0${secure ? '; Secure' : ''}`;
  }

  return { username: normalizedUsername, issueToken, verifyToken, verifyCredentials, tokenFromRequest, session, revoke, sessionCookie, clearCookie };
}
