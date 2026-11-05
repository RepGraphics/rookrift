import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import { deliveryIdentifier } from '../shared/store-delivery.js';
import { hash } from './crypto.js';

const fail = (message, status = 400) => { throw Object.assign(new Error(message), { status }); };
const accountInput = z.object({
  game: z.enum(['asa', 'ase', 'dayz']),
  identifier: z.string().trim().min(3).max(100),
  label: z.string().trim().max(80).default('')
}).strict();
const linkGame = z.enum(['asa', 'ase', 'dayz']);
const linkEvent = z.object({
  server_id: z.string().uuid(),
  message: z.string().trim().min(1).max(1000)
}).strict();
const ansi = message => message.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '');
const codeFromMessage = message => ansi(message).match(/(?:^|\s)\/link\s+([A-Z0-9-]{6,32})(?:\s|$)/im)?.[1]?.toUpperCase() || null;
const playerNameFromMessage = message => {
  const normalized = ansi(message).replace(/\r/g, '');
  const chat = normalized.match(/(?:\[(?:chat|global|local|serverchat)\])\s*(?:\[[^\]]+\]\s*)*([^:\]\r\n]{1,100}):\s*\/link\b/im)?.[1]
    || normalized.match(/\]\s*([^:\]\r\n]{1,100}):\s*\/link\b/im)?.[1]
    || normalized.match(/(?:Player|Name)\s*[=:]\s*([^,\]\r\n]{1,100})(?:,[^:\r\n]*)?:\s*\/link\b/im)?.[1]
    || normalized.match(/(?:^|\n)\s*([^:\r\n]{1,100}):\s*\/link\b/im)?.[1];
  return chat?.trim() || null;
};

export function createCommunityMembers(db, { service } = {}) {
  const community = async slug => {
    const row = await db.prepare('SELECT workspace_id FROM community_sites WHERE slug=? AND enabled=1').get(slug);
    if (!row) fail('Community page not found.', 404);
    return row.workspace_id;
  };
  const ensure = async (workspace, user) => {
    await db.prepare('INSERT INTO community_members(workspace_id,user_id,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(workspace, user.id, Date.now(), Date.now());
  };
  const list = async (workspace, user) => {
    await ensure(workspace, user);
    return {
      display_name: (await db.prepare('SELECT display_name FROM community_members WHERE workspace_id=? AND user_id=?').get(workspace, user.id)).display_name,
      accounts: await db.prepare('SELECT id,game,identifier,label,verified,created_at FROM community_game_accounts WHERE workspace_id=? AND user_id=? ORDER BY created_at,id').all(workspace, user.id)
    };
  };
  const linkFromMessage = async (server, message) => {
    const code = codeFromMessage(message), playerName = playerNameFromMessage(message);
    if (!code || !playerName) return { linked: false, ignored: true };
    const pending = await db.prepare('SELECT * FROM community_link_codes WHERE code_hash=? AND workspace_id=? AND game=? AND used_at IS NULL AND expires_at>?').get(hash(`RR-${code.replace(/^RR-/i, '')}`), server.workspace_id, server.game, Date.now());
    if (!pending) return { linked: false, ignored: true };
    if (!service?.action) fail('Server link verification is unavailable.', 503);
    await service.action(server.workspace_id, server.id, 'status', '', 'Chat account linking');
    const latest = await service.getServer(server.workspace_id, server.id, false);
    let players;
    try { players = JSON.parse(latest.player_list || '[]'); } catch { players = []; }
    const match = players.map(line => {
      const parts = String(line).split(',');
      return { name: parts.slice(0, -1).join(',').trim(), identifier: parts.at(-1)?.trim() };
    }).find(player => player.name.toLowerCase() === playerName.toLowerCase());
    if (!match?.identifier) return { linked: false, ignored: true };
    const identifier = deliveryIdentifier(match.identifier, 'game');
    await db.transaction(async () => {
      await db.prepare('INSERT INTO community_members(workspace_id,user_id,created_at,updated_at) VALUES(?,?,?,?) ON CONFLICT DO NOTHING').run(server.workspace_id, pending.user_id, Date.now(), Date.now());
      await db.prepare('INSERT INTO community_game_accounts(id,workspace_id,user_id,game,identifier,label,verified,created_at) VALUES(?,?,?,?,?,?,1,?) ON CONFLICT(workspace_id,user_id,game,identifier) DO UPDATE SET verified=1').run(randomUUID(), server.workspace_id, pending.user_id, server.game, identifier, 'Linked from server chat', Date.now());
      await db.prepare('UPDATE community_link_codes SET used_at=? WHERE code_hash=? AND used_at IS NULL').run(Date.now(), pending.code_hash);
    });
    let notified = true;
    try {
      await service.directMessage(server.workspace_id, server.id, playerName, 'Your Rookrift game account has been linked successfully.');
    } catch (error) {
      notified = false;
      console.error(`Account-link confirmation failed for ${server.id}: ${error.message}`);
    }
    return { linked: true, game: server.game, identifier, notified };
  };
  return {
    async view(slug, user) {
      if (!user) fail('Sign in to manage your community member account.', 401);
      return list(await community(slug), user);
    },
    async add(slug, user, input) {
      if (!user) fail('Sign in to link a game account.', 401);
      const value = accountInput.parse(input), workspace = await community(slug);
      try {
        const identifier = deliveryIdentifier(value.identifier, 'game');
        await ensure(workspace, user);
        await db.prepare('INSERT INTO community_game_accounts(id,workspace_id,user_id,game,identifier,label,created_at) VALUES(?,?,?,?,?,?,?)').run(randomUUID(), workspace, user.id, value.game, identifier, value.label, Date.now());
      } catch (error) {
        if (error.code === '23505') fail('That game account is already linked to this community.', 409);
        throw error;
      }
      return list(workspace, user);
    },
    async createLinkCode(slug, user, game) {
      if (!user) fail('Sign in to link a game account.', 401);
      const value = linkGame.parse(game), workspace = await community(slug);
      const code = `RR-${randomBytes(5).toString('hex').toUpperCase()}`, expires = Date.now() + 10 * 60 * 1000;
      await db.prepare('DELETE FROM community_link_codes WHERE user_id=? AND workspace_id=? AND (used_at IS NOT NULL OR expires_at<?)').run(user.id, workspace, Date.now());
      await db.prepare('INSERT INTO community_link_codes(code_hash,workspace_id,user_id,game,expires_at,created_at) VALUES(?,?,?,?,?,?)').run(hash(code), workspace, user.id, value, expires, Date.now());
      return { code, game: value, expires_at: expires, command: `/link ${code}` };
    },
    async ingestServerChat(serverId, message) {
      const server = await db.prepare('SELECT id,workspace_id,game FROM servers WHERE id=?').get(serverId);
      if (!server) fail('Server not found.', 404);
      return linkFromMessage(server, message);
    },
    async ingestChatEvent(token, input) {
      const value = linkEvent.parse(input), server = await db.prepare('SELECT id,workspace_id,game FROM servers WHERE id=? AND link_ingest_token_hash=?').get(value.server_id, hash(token || ''));
      if (!server) fail('Invalid server link-agent credentials.', 401);
      return linkFromMessage(server, value.message);
    },
    async remove(slug, user, id) {
      if (!user) fail('Sign in to manage linked game accounts.', 401);
      const workspace = await community(slug);
      const result = await db.prepare('DELETE FROM community_game_accounts WHERE id=? AND workspace_id=? AND user_id=?').run(id, workspace, user.id);
      if (!result.changes) fail('Linked game account not found.', 404);
      return list(workspace, user);
    },
    async resolve(workspace, user, id) {
      if (!id) return null;
      return db.prepare('SELECT game,identifier FROM community_game_accounts WHERE id=? AND workspace_id=? AND user_id=?').get(id, workspace, user.id);
    }
  };
}
