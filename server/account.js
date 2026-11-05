import { randomBytes, randomUUID, createHmac } from 'node:crypto';
import { generateRegistrationOptions, verifyRegistrationResponse, generateAuthenticationOptions, verifyAuthenticationResponse } from '@simplewebauthn/server';
import { hash, hashPassword, verifyPassword } from './crypto.js';
import {createEmail} from './email.js';
import {withAccountLock,assertAccountOpen} from './account-lock.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const base32 = value => {const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=0,buffer=0,result='';for(const byte of value){buffer=(buffer<<8)|byte;bits+=8;while(bits>=5){bits-=5;result+=alphabet[(buffer>>>bits)&31];}}if(bits)result+=alphabet[(buffer<<(5-bits))&31];return result;};
const hotp = (secret, counter) => {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = ''; for (const char of secret) { const n = alphabet.indexOf(char); if (n >= 0) bits += n.toString(2).padStart(5, '0'); }
  const bytes = Buffer.alloc(Math.floor(bits.length / 8)); for (let i = 0; i < bytes.length; i++) bytes[i] = parseInt(bits.slice(i * 8, i * 8 + 8), 2);
  const mac = createHmac('sha1', bytes).update(Buffer.from(BigInt(counter).toString(16).padStart(16, '0'), 'hex')).digest();
  const offset = mac.at(-1) & 15; return String((mac.readUInt32BE(offset) & 0x7fffffff) % 1000000).padStart(6, '0');
};
const totpValid = (secret, code) => [ -1, 0, 1 ].some(offset => hotp(secret, Math.floor(Date.now() / 30000) + offset) === String(code).trim());
const profileImage = value => {
  if (value == null || value === '') return null;
  if (typeof value !== 'string' || !/^data:image\/(?:png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(value) || Buffer.byteLength(value, 'utf8') > 4 * 1024 * 1024) fail('Use a PNG, JPEG, or WebP profile image up to 3 MB.');
  return value;
};

export function createAccount(db, vault, env, billing, providedEmail) {
  const rpID = new URL(env.APP_URL || 'http://localhost:3000').hostname;
  const origin = new URL(env.APP_URL || 'http://localhost:3000').origin;
  const emailService=providedEmail||createEmail(db,vault,env);
  const security = async userId => await db.prepare('SELECT * FROM account_security WHERE user_id=?').get(userId);
  const ensureSecurity = async userId => { await db.prepare('INSERT INTO account_security(user_id,updated_at) VALUES(?,?) ON CONFLICT DO NOTHING').run(userId, Date.now()); return security(userId); };
  const passkeys = async userId => (await db.prepare('SELECT id,credential_id,label,created_at,last_used_at FROM account_passkeys WHERE user_id=? ORDER BY created_at').all(userId)).map(row => ({ ...row, credential_id: undefined }));
  const get = async userId => {
    const user = await db.prepare('SELECT id,name,username,avatar,discord_id FROM users WHERE id=?').get(userId);
    const local = await db.prepare('SELECT email FROM local_accounts WHERE user_id=?').get(userId);
    const safe = await ensureSecurity(userId);
    const workspaces = await db.prepare('SELECT id,name,plan,subscription_status,created_at,customer_id FROM workspaces WHERE owner_id=? ORDER BY created_at').all(userId);
    return { profile: { ...user, email: local?.email || null, discord_linked: Boolean(user.discord_id) }, security: { totp_enabled: Boolean(safe.totp_enabled), passkeys: await passkeys(userId) }, billing: await billing.accountHistory(workspaces) };
  };
  const challenge = async (userId, kind, value) => { await db.prepare('DELETE FROM account_challenges WHERE user_id=? OR expires_at<?').run(userId, Date.now()); const id = randomUUID(); await db.prepare('INSERT INTO account_challenges VALUES(?,?,?,?,?)').run(id, userId, value, kind, Date.now() + 300000); return id; };
  const consumeChallenge = async (id, userId, kind) => { const row = await db.prepare('DELETE FROM account_challenges WHERE id=? AND user_id IS NOT DISTINCT FROM ? AND kind=? AND expires_at>? RETURNING challenge').get(id, userId, kind, Date.now()); if (!row) fail('This security challenge has expired. Try again.', 400); return row.challenge; };
  return {
    get,
    async updateProfile(userId, input) {
      const name = String(input.name || '').trim(), username = String(input.username || '').trim().toLowerCase();
      if (name.length < 2 || name.length > 80 || !/^[a-z0-9_]{3,30}$/.test(username)) fail('Enter a name and a username using 3–30 letters, numbers, or underscores.');
      try { await db.prepare('UPDATE users SET name=?,username=?,avatar=? WHERE id=?').run(name, username, profileImage(input.avatar), userId); } catch (error) { if (error.code === '23505') fail('That username is already in use.', 409); throw error; }
      return get(userId);
    },
    async updateEmail(userId, input) {
      const email = String(input.email || '').trim().toLowerCase(); if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) fail('Enter a valid email address.');
      const local = await db.prepare('SELECT password_hash FROM local_accounts WHERE user_id=?').get(userId); if (!local || !(await verifyPassword(input.password, local.password_hash))) fail('Your current password is incorrect.', 401);
      try { await db.prepare('UPDATE local_accounts SET email=? WHERE user_id=?').run(email, userId); } catch (error) { if (error.code === '23505') fail('That email address is already in use.', 409); throw error; }
      return get(userId);
    },
    async changePassword(userId, input, sessionHash) {
      const local = await db.prepare('SELECT password_hash FROM local_accounts WHERE user_id=?').get(userId); if (!local || !(await verifyPassword(input.current_password, local.password_hash))) fail('Your current password is incorrect.', 401);
      if (typeof input.password !== 'string' || input.password.length < 8 || input.password.length > 128) fail('Choose a password between 8 and 128 characters.');
      await db.prepare('UPDATE local_accounts SET password_hash=? WHERE user_id=?').run(await hashPassword(input.password), userId);
      await db.prepare('DELETE FROM sessions WHERE user_id=? AND token_hash<>?').run(userId, sessionHash);
      return { ok: true };
    },
    async setupTotp(userId) {
      const secret = base32(randomBytes(20)); await db.prepare('INSERT INTO account_security(user_id,totp_secret,updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET totp_secret=excluded.totp_secret,updated_at=excluded.updated_at').run(userId, secret, Date.now());
      const email = (await db.prepare('SELECT email FROM local_accounts WHERE user_id=?').get(userId))?.email || userId;
      return { secret, otpauth_url: `otpauth://totp/Rookrift:${encodeURIComponent(email)}?secret=${secret}&issuer=Rookrift` };
    },
    async confirmTotp(userId, code) { const row = await security(userId); if (!row?.totp_secret || !totpValid(row.totp_secret, code)) fail('That authenticator code is invalid.', 400); await db.prepare('UPDATE account_security SET totp_enabled=1,updated_at=? WHERE user_id=?').run(Date.now(), userId); return get(userId); },
    async verifyTotp(userId, code) { const row = await security(userId); return !row?.totp_enabled || Boolean(row.totp_secret && totpValid(row.totp_secret, code)); },
    async disableTotp(userId, input) { const row = await security(userId); if (!row?.totp_enabled || !totpValid(row.totp_secret, input.code)) fail('That authenticator code is invalid.', 400); await db.prepare('UPDATE account_security SET totp_enabled=0,totp_secret=NULL,updated_at=? WHERE user_id=?').run(Date.now(), userId); return get(userId); },
    async registrationOptions(userId) {
      const existing = await db.prepare('SELECT credential_id FROM account_passkeys WHERE user_id=?').all(userId);
      const user = await db.prepare('SELECT username,name FROM users WHERE id=?').get(userId);
      const options = await generateRegistrationOptions({ rpName: 'Rookrift', rpID, userName: user.username || user.name, userDisplayName: user.name, userID: Buffer.from(userId), excludeCredentials: existing.map(row => ({ id: row.credential_id })), authenticatorSelection: { residentKey: 'required', userVerification: 'required' } });
      const id = await challenge(userId, 'registration', options.challenge); return { ...options, challenge_id: id };
    },
    async registerPasskey(userId, input) {
      const expected = await consumeChallenge(input.challenge_id, userId, 'registration');
      const verification = await verifyRegistrationResponse({ response: input.response, expectedChallenge: expected, expectedOrigin: origin, expectedRPID: rpID, requireUserVerification: true });
      if (!verification.verified || !verification.registrationInfo) fail('Passkey registration was not verified.', 400);
      const info = verification.registrationInfo;
      await db.prepare('INSERT INTO account_passkeys VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(), userId, info.credential.id, Buffer.from(info.credential.publicKey), info.credential.counter, JSON.stringify(input.response.response.transports || []), String(input.label || 'Passkey').trim().slice(0, 80) || 'Passkey', Date.now(), null);
      return get(userId);
    },
    async authenticationOptions() {
      const options = await generateAuthenticationOptions({ rpID, userVerification: 'required', allowCredentials: [] });
      const id = await challenge(null, 'authentication', options.challenge);
      return { ...options, challenge_id: id };
    },
    async authenticatePasskey(input) {
      const expected = await consumeChallenge(input.challenge_id, null, 'authentication');
      const credential = await db.prepare('SELECT * FROM account_passkeys WHERE credential_id=?').get(input.response.id);
      if (!credential) fail('That passkey is not registered.', 401);
      const verification = await verifyAuthenticationResponse({ response: input.response, expectedChallenge: expected, expectedOrigin: origin, expectedRPID: rpID, authenticator: { credentialID: credential.credential_id, credentialPublicKey: credential.public_key, counter: credential.counter }, requireUserVerification: true });
      if (!verification.verified) fail('Passkey verification failed.', 401);
      await db.prepare('UPDATE account_passkeys SET counter=?,last_used_at=? WHERE id=?').run(verification.authenticationInfo.newCounter, Date.now(), credential.id);
      return { user_id: credential.user_id };
    },
    async removePasskey(userId, id) { if (!(await db.prepare('DELETE FROM account_passkeys WHERE id=? AND user_id=?').run(id, userId)).changes) fail('Passkey not found.', 404); return get(userId); },
    async requestReset(email) {
      const local = await db.prepare('SELECT a.user_id FROM local_accounts a JOIN users u ON u.id=a.user_id WHERE a.email=? AND u.deleting_at IS NULL AND NOT EXISTS(SELECT 1 FROM suspended_users s WHERE s.user_id=u.id)').get(String(email || '').trim().toLowerCase());
      if (!local) return { ok: true };
      await withAccountLock(local.user_id,async()=>{const user=await db.prepare('SELECT id,deleting_at FROM users WHERE id=?').get(local.user_id);if(!user||user.deleting_at)return;if(await db.prepare('SELECT 1 FROM password_reset_tokens WHERE user_id=? AND expires_at>? AND used_at IS NULL').get(local.user_id,Date.now()+3540000))return;const token=randomBytes(32).toString('hex'),expires=Date.now()+3600000;await db.transaction(async()=>{if(await emailService.passwordReset(local.user_id,token,expires))await db.prepare('INSERT INTO password_reset_tokens VALUES(?,?,?,NULL)').run(hash(token),local.user_id,expires);});});
      return { ok: true };
    },
    async resetPassword(token, password) {
      if (typeof password !== 'string' || password.length < 8 || password.length > 128) fail('Choose a password between 8 and 128 characters.');
      if(!/^[a-f0-9]{64}$/.test(token||''))fail('This password reset link is invalid or expired.',400);
      const row=await db.prepare('SELECT user_id FROM password_reset_tokens WHERE token_hash=? AND expires_at>? AND used_at IS NULL').get(hash(token),Date.now());if(!row)fail('This password reset link is invalid or expired.',400);
      return withAccountLock(row.user_id,async()=>{await assertAccountOpen(db,row.user_id);const encoded=await hashPassword(password);return db.transaction(async()=>{if(!await db.prepare('DELETE FROM password_reset_tokens WHERE token_hash=? AND expires_at>? RETURNING user_id').get(hash(token),Date.now()))fail('This password reset link is invalid or expired.',400);await db.prepare('UPDATE local_accounts SET password_hash=? WHERE user_id=?').run(encoded,row.user_id);for(const table of ['sessions','password_reset_tokens','login_challenges'])await db.prepare('DELETE FROM '+table+' WHERE user_id=?').run(row.user_id);await db.prepare("UPDATE email_outbox SET status='cancelled',payload=NULL,last_error='Password already updated.' WHERE user_id=? AND kind='password_reset' AND status IN ('pending','failed')").run(row.user_id);return{ok:true};});});
    }
  };
}
