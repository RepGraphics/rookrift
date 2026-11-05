import { randomUUID, randomBytes } from 'node:crypto';
import { z } from 'zod';
import { hash } from './crypto.js';
import { effectivePlan } from './plans.js';
const fail = (message, status = 403) => Object.assign(new Error(message), {
  status
});
const role = z.enum(['admin', 'moderator', 'viewer']);
const scope = z.array(z.string().uuid()).min(1).max(20).refine(ids => new Set(ids).size === ids.length).nullable();
const memberSchema = z.object({
  role,
  server_ids: scope
}).strict();
export async function staffAudit(db, workspace, user, action, resource = null, server = null) {
  await db.prepare('INSERT INTO staff_audit VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(), workspace, user.id, user.name, action, resource, server, Date.now());
}
export function createTeam(db) {
  const workspace = async id => await db.prepare('SELECT * FROM workspaces WHERE id=?').get(id);
  const members = async id => await db.prepare('SELECT m.*,u.name FROM workspace_members m JOIN users u ON u.id=m.user_id WHERE m.workspace_id=? ORDER BY m.created_at,m.id').all(id);
  async function validateScope(workspaceId, ids) {
    if (ids) for (const id of ids) if (!(await db.prepare('SELECT id FROM servers WHERE id=? AND workspace_id=?').get(id, workspaceId))) throw fail('Choose servers from this workspace.', 404);
  }
  async function access(workspaceId, userId) {
    const ws = await workspace(workspaceId);
    if (!ws) return null;
    if (ws.owner_id === userId) return {
      role: 'owner',
      server_ids: null
    };
    const rows = await members(workspaceId),
      index = rows.findIndex(row => row.user_id === userId);
    if (index < 0 || index >= effectivePlan(ws).staff) return null;
    const row = rows[index];
    return {
      role: row.role,
      server_ids: row.server_ids === null ? null : JSON.parse(row.server_ids)
    };
  }
  async function listWorkspaces(userId) {
    return (await Promise.all((await db.prepare('SELECT DISTINCT w.id,w.name,w.owner_id,w.created_at FROM workspaces w LEFT JOIN workspace_members m ON m.workspace_id=w.id WHERE w.owner_id=? OR m.user_id=? ORDER BY w.created_at,w.id').all(userId, userId)).map(async ws => ({
      id: ws.id,
      name: ws.name,
      ...(await access(ws.id, userId))
    })))).filter(ws => ws.role);
  }
  async function invitation(token, userId, lock = false) {
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw fail('Invitation is invalid or expired.', 410);
    const row = await db.prepare('SELECT * FROM team_invitations WHERE token_hash=?' + (lock ? ' FOR UPDATE' : '')).get(hash(token));
    if (!row || row.accepted_at || row.revoked_at || row.expires_at <= Date.now()) throw fail('Invitation is invalid or expired.', 410);
    if (row.discord_user_id !== userId) throw fail('Sign in with the Discord account this invitation was created for.');
    return row;
  }
  async function summary(workspaceId) {
    const ws = await workspace(workspaceId),
      limit = effectivePlan(ws).staff;
    return {
      limit,
      members: (await members(workspaceId)).map(({
        server_ids,
        ...row
      }, index) => ({
        ...row,
        server_ids: server_ids === null ? null : JSON.parse(server_ids),
        paused: index >= limit
      })),
      invitations: (await db.prepare('SELECT id,discord_user_id,role,server_ids,created_at,expires_at FROM team_invitations WHERE workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL AND expires_at>? ORDER BY created_at,id').all(workspaceId, Date.now())).map(row => ({
        ...row,
        server_ids: row.server_ids === null ? null : JSON.parse(row.server_ids)
      })),
      audit: await db.prepare('SELECT * FROM staff_audit WHERE workspace_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(workspaceId)
    };
  }
  return {
    access,
    listWorkspaces,
    summary,
    async resolve(session) {
      const selection = await db.prepare('SELECT workspace_id FROM session_workspaces WHERE token_hash=?').get(session.token_hash);
      let id = selection?.workspace_id;
      id ??= (await listWorkspaces(session.user_id)).find(ws => ws.role === 'owner')?.id || (await listWorkspaces(session.user_id))[0]?.id;
      if(!id){await db.prepare('INSERT INTO workspaces(id,owner_id,created_at) VALUES(?,?,?) ON CONFLICT(owner_id) DO NOTHING').run(randomUUID(),session.user_id,Date.now());id=(await db.prepare('SELECT id FROM workspaces WHERE owner_id=?').get(session.user_id)).id;}
      const granted=await access(id,session.user_id);
      if(!granted){await db.prepare('DELETE FROM session_workspaces WHERE token_hash=?').run(session.token_hash);throw fail('Your access to this workspace has ended or is paused. Reload to return to your workspace.');}
      return {
        workspace: await workspace(id),
        access: granted
      };
    },
    async switchWorkspace(session, id) {
      if (!(await access(id, session.user_id))) throw fail('Workspace not available.', 404);
      await db.prepare('INSERT INTO session_workspaces VALUES(?,?) ON CONFLICT(token_hash) DO UPDATE SET workspace_id=excluded.workspace_id').run(session.token_hash, id);
      return {
        ok: true
      };
    },
    async invite(workspaceId, input, user, origin) {
      return await db.withWorkspaceLock(workspaceId, async () => {
        const value = memberSchema.extend({
            discord_user_id: z.string().regex(/^\d{17,20}$/)
          }).parse(input),
          ws = await workspace(workspaceId);
        await validateScope(workspaceId, value.server_ids);
        if (value.discord_user_id === ws.owner_id || (await members(workspaceId)).some(row => row.user_id === value.discord_user_id)) throw fail('That Discord account already has access.', 409);
        const state = await summary(workspaceId);
        if (state.members.length + state.invitations.length >= state.limit) throw fail(`Your plan includes ${state.limit} staff seats. Remove a member or invitation, or upgrade.`);
        if (state.invitations.some(row => row.discord_user_id === value.discord_user_id)) throw fail('There is already a pending invitation for this account.', 409);
        const id = randomUUID(),
          token = randomBytes(32).toString('hex'),
          now = Date.now();
        await db.prepare('INSERT INTO team_invitations VALUES(?,?,?,?,?,?,?,?,NULL,NULL)').run(id, workspaceId, value.discord_user_id, value.role, value.server_ids === null ? null : JSON.stringify(value.server_ids), hash(token), now, now + 7 * 86400000);
        await staffAudit(db, workspaceId, user, 'Created team invitation', id);
        return {
          id,
          url: `${origin}/dashboard#invite=${token}`,
          expires_at: now + 7 * 86400000
        };
      });
    },
    async preview(token, userId) {
      const row = await invitation(token, userId),
        ws = await workspace(row.workspace_id);
      return {
        workspace: ws.name,
        role: row.role,
        server_names: row.server_ids === null ? null : (await Promise.all(JSON.parse(row.server_ids).map(async id => (await db.prepare('SELECT name FROM servers WHERE id=? AND workspace_id=?').get(id, row.workspace_id))?.name))).filter(Boolean),
        expires_at: row.expires_at
      };
    },
    async accept(token, user, session) {
      const initial = await invitation(token,user.id);
      try {
        return await db.withWorkspaceLock(initial.workspace_id,async()=>{
          const row=await invitation(token,user.id,true),ws=await workspace(row.workspace_id);
          if((await members(ws.id)).length>=effectivePlan(ws).staff)throw fail('This workspace has no available staff seats. Contact its owner.');
          let ids=null;
          if(row.server_ids!==null){ids=[];for(const id of JSON.parse(row.server_ids))if(await db.prepare('SELECT id FROM servers WHERE id=? AND workspace_id=?').get(id,ws.id))ids.push(id);}
          if(ids?.length===0)throw fail('This invitation no longer includes an available server. Contact its owner.',410);
          await db.prepare('INSERT INTO workspace_members VALUES(?,?,?,?,?,?)').run(randomUUID(),ws.id,user.id,row.role,ids===null?null:JSON.stringify(ids),Date.now());
          await db.prepare('UPDATE team_invitations SET accepted_at=? WHERE id=?').run(Date.now(),row.id);
          await db.prepare('INSERT INTO session_workspaces VALUES(?,?) ON CONFLICT(token_hash) DO UPDATE SET workspace_id=excluded.workspace_id').run(session.token_hash,ws.id);
          await staffAudit(db,ws.id,user,'Accepted team invitation',row.id);
          return{ok:true,workspace_id:ws.id};
        });
      }catch(error){if(error.code==='23505')throw fail('This account already has access.',409);throw error;}
    },
    async update(workspaceId, id, input, user) {
      const value = memberSchema.parse(input);
      await validateScope(workspaceId, value.server_ids);
      if (!(await db.prepare('SELECT id FROM workspace_members WHERE id=? AND workspace_id=?').get(id, workspaceId))) throw fail('Team member not found.', 404);
      await db.prepare('UPDATE workspace_members SET role=?,server_ids=? WHERE id=? AND workspace_id=?').run(value.role, value.server_ids === null ? null : JSON.stringify(value.server_ids), id, workspaceId);
      await staffAudit(db, workspaceId, user, 'Updated member permissions', id);
      return {
        ok: true
      };
    },
    async remove(workspaceId, id, user) {
      if (!(await db.prepare('DELETE FROM workspace_members WHERE id=? AND workspace_id=?').run(id, workspaceId)).changes) throw fail('Team member not found.', 404);
      await staffAudit(db, workspaceId, user, 'Removed team member', id);
      return {
        ok: true
      };
    },
    async revoke(workspaceId, id, user) {
      if (!(await db.prepare('UPDATE team_invitations SET revoked_at=? WHERE id=? AND workspace_id=? AND accepted_at IS NULL AND revoked_at IS NULL').run(Date.now(), id, workspaceId)).changes) throw fail('Invitation not found.', 404);
      await staffAudit(db, workspaceId, user, 'Revoked team invitation', id);
      return {
        ok: true
      };
    }
  };
}
