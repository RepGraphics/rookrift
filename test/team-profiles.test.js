import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { randomBytes } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve, sep, basename } from 'node:path';
import { openDatabase } from '../server/db.js';
import { createVault, hash } from '../server/crypto.js';
import { createService } from '../server/service.js';
import { createApp } from '../server/app.js';
import { createTeam } from '../server/team.js';
import { createPlayerProfiles, observePlayers } from '../server/player-profiles.js';
import { createBanDirectory } from '../server/ban-directory.js';
const ids = {
    owner: '123456789012345678',
    staff: '223456789012345678',
    other: '323456789012345678'
  },
  eos = '0002aaaaaaaaaaaaaaaaaaaaaaaaaaaa';
test('server game changes cannot relabel existing player or moderation history', async t => {
  const f = await fixture(t);
  await assert.rejects(async () => await f.service.updateServer('w-owner', f.allowed.id, {
    game: 'ase'
  }), /new connection/);
  assert.equal((await f.service.getServer('w-owner', f.allowed.id)).game, 'asa');
});
test('moderators can edit their own notes, while another moderator cannot edit or remove them', async t => {
  const f = await fixture(t);
  await f.join('moderator');
  await f.join('moderator', [f.allowed.id], 'other');
  const id = (await f.profiles.list('w-owner', {
    search: eos
  })).items[0].id;
  const note = await f.request('/player-profiles/' + id + '/notes', {
    as: 'staff',
    method: 'POST',
    body: {
      server_id: f.allowed.id,
      body: 'Author note'
    }
  });
  for (const method of ['PATCH', 'DELETE']) assert.equal((await f.request('/player-profiles/' + id + '/notes/' + note.body.id, {
    as: 'other',
    method,
    body: method === 'PATCH' ? {
      body: 'Overwrite'
    } : undefined
  })).status, 403);
  assert.equal((await f.request('/player-profiles/' + id + '/notes/' + note.body.id, {
    method: 'PATCH',
    body: {
      body: 'Owner correction'
    }
  })).status, 200);
});
test('ban directory scopes private matches to the member’s granted servers', async t => {
  const f = await fixture(t);
  const {
    createOperations
  } = await import('../server/operations.js');
  const ops = createOperations(f.db, null, f.service);
  await ops.moderate('w-owner', {
    server_id: f.hidden.id,
    identifier: eos,
    action: 'ban',
    reason: 'Hidden server report'
  }, 'Owner');
  await f.join();
  const own = await f.request('/ban-directory/bans?status=all', {
    as: 'staff'
  });
  assert.equal(own.status, 200);
  assert.equal(own.body.total, 0);
  const lookup = await f.request('/ban-directory/search', {
    as: 'staff',
    method: 'POST',
    body: {
      identifier: eos,
      include_withdrawn: true
    }
  });
  assert.equal(lookup.body.own.total, 0);
  assert.equal(JSON.stringify(lookup.body).includes('HIDDEN'), false);
});
test('expired invitations cannot be previewed or redeemed', async t => {
  const f = await fixture(t),
    invite = await f.team.invite('w-owner', {
      discord_user_id: ids.staff,
      role: 'viewer',
      server_ids: null
    }, {
      id: ids.owner,
      name: 'Owner'
    }, 'http://localhost:3000'),
    token = invite.url.split('#invite=')[1];
  await f.db.prepare('UPDATE team_invitations SET expires_at=0 WHERE id=?').run(invite.id);
  for (const endpoint of ['preview', 'accept']) assert.equal((await f.request('/team/invitations/' + endpoint, {
    as: 'staff',
    method: 'POST',
    body: {
      token
    }
  })).status, 410);
});
async function fixture(t) {
  const db = await openDatabase(':memory:'),
    vault = createVault(randomBytes(32).toString('hex'));
  for (const [key, id] of Object.entries(ids)) {
    await db.prepare('INSERT INTO users VALUES(?,?,?,?)').run(id, key, null, 'encrypted');
    await db.prepare('INSERT INTO sessions VALUES(?,?,?,?)').run(hash(key), id, 'csrf', Date.now() + 600000);
    await db.prepare("INSERT INTO workspaces(id,owner_id,name,plan,subscription_status,created_at) VALUES(?,?,?,'tribe','active',?)").run('w-' + key, id, key + ' workspace', Date.now());
  }
  let players = [`Visible survivor, ${eos}`];
  const calls = [],
    service = createService(db, vault, async (server, vault, action, message) => {
      calls.push({
        id: server.id,
        action,
        message
      });
      return {
        output: 'Command acknowledged.',
        players: action === 'status' ? players : undefined,
        latency: 1
      };
    });
  const input = {
    name: 'Allowed server',
    game: 'asa',
    map: 'Island',
    host: '8.8.8.8',
    port: 27020,
    password: 'secret',
    cluster: 'Allowed cluster'
  };
  const allowed = await service.addServer('w-owner', input),
    hidden = await service.addServer('w-owner', {
      ...input,
      name: 'HIDDEN SERVER',
      cluster: 'HIDDEN CLUSTER'
    });
  await service.action('w-owner', allowed.id, 'status');
  players = [`HIDDEN PLAYER, ${eos}`, 'Exclusive hidden, HIDDEN-ID'];
  await service.action('w-owner', hidden.id, 'status');
  players = [`Visible survivor, ${eos}`];
  const team = createTeam(db),
    profiles = createPlayerProfiles(db),
    app = createApp({
      db,
      vault,
      service,
      billing: {
        ready: false
      },
      env: {
        APP_URL: 'http://localhost:3000'
      }
    }),
    server = app.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const url = 'http://127.0.0.1:' + server.address().port;
  t.after(async () => {
    server.closeAllConnections();
    server.close();
    await db.close();
  });
  const request = async (path, {
    as = 'owner',
    method = 'GET',
    body,
    headers = {}
  } = {}) => {
    const r = await fetch(url + '/api' + path, {
      method,
      headers: {
        Cookie: `rookrift_session=${as}`,
        Origin: 'http://localhost:3000',
        'X-CSRF-Token': 'csrf',
        'Content-Type': 'application/json',
        ...headers
      },
      ...(body ? {
        body: JSON.stringify(body)
      } : {})
    });
    return {
      status: r.status,
      body: await r.json()
    };
  };
  async function join(role = 'viewer', scope = [allowed.id], as = 'staff') {
    const invite = await team.invite('w-owner', {
      discord_user_id: ids[as],
      role,
      server_ids: scope
    }, {
      id: ids.owner,
      name: 'Owner'
    }, 'http://localhost:3000');
    const token = invite.url.split('#invite=')[1];
    const result = await request('/team/invitations/accept', {
      as,
      method: 'POST',
      body: {
        token
      }
    });
    assert.equal(result.status, 200);
    return (await team.summary('w-owner')).members.find(m => m.user_id === ids[as]);
  }
  return {
    db,
    service,
    team,
    profiles,
    allowed,
    hidden,
    calls,
    request,
    join,
    setPlayers: value => {
      players = value;
    }
  };
}
test('persistent profiles retain sightings after disconnect and normalize repeated IDs without conflating games', async t => {
  const f = await fixture(t);
  const before = await f.profiles.list('w-owner', {
    search: 'Visible survivor'
  });
  assert.equal(before.total, 1);
  const id = before.items[0].id,
    lastSeen = (await f.profiles.detail('w-owner', id, [f.allowed.id])).last_seen;
  f.setPlayers([]);
  await f.service.action('w-owner', f.allowed.id, 'status');
  let detail = await f.profiles.detail('w-owner', id, [f.allowed.id]);
  assert.equal(detail.online, false);
  assert.equal(detail.servers[0].last_seen, lastSeen);
  f.setPlayers([`Renamed survivor, ${eos.toUpperCase()}`]);
  await f.service.action('w-owner', f.allowed.id, 'status');
  assert.equal((await f.profiles.list('w-owner', {
    search: 'Renamed survivor'
  })).items[0].id, id);
  await observePlayers(f.db, {
    ...(await f.service.getServer('w-owner', f.allowed.id)),
    game: 'ase'
  }, [`Legacy survivor, ${eos}`], Date.now() + 1000);
  assert.equal((await f.profiles.list('w-owner', {
    game: 'ase'
  })).total, 1);
  assert.equal((await f.profiles.list('w-owner', {
    game: 'asa'
  })).items.some(row => row.id === id), true);
});
test('profile search is paginated, literal for SQL wildcards, and excludes invalid/duplicate snapshot identifiers', async t => {
  const f = await fixture(t);
  const server = await f.service.getServer('w-owner', f.allowed.id);
  await observePlayers(f.db, server, ['No ID', 'Bad, ID|COMMAND', 'Duplicate, PLAYER-000', 'Duplicate, PLAYER-000', ...Array.from({
    length: 29
  }, (_, n) => `Name ${n}, PLAYER-${String(n).padStart(3, '0')}`)]);
  assert.equal((await f.profiles.list('w-owner', {
    search: 'PLAYER-'
  })).total, 29);
  assert.equal((await f.profiles.list('w-owner', {
    search: 'PLAYER-',
    page: 2
  })).items.length, 4);
  assert.equal((await f.profiles.list('w-owner', {
    search: '%'
  })).total, 0);
  assert.equal((await f.profiles.list('w-owner', {
    search: 'ID|COMMAND'
  })).total, 0);
});
test('profile details and notes reveal only the member’s allowed servers', async t => {
  const f = await fixture(t);
  const id = (await f.profiles.list('w-owner', {
    search: eos
  })).items[0].id;
  await f.profiles.addNote('w-owner', id, {
    server_id: f.hidden.id,
    body: 'HIDDEN NOTE'
  }, {
    id: ids.owner,
    name: 'Owner'
  });
  await f.profiles.addNote('w-owner', id, {
    server_id: f.allowed.id,
    body: 'Visible note'
  }, {
    id: ids.owner,
    name: 'Owner'
  });
  await f.join();
  const result = await f.request('/player-profiles/' + id, {
    as: 'staff'
  });
  assert.equal(result.status, 200);
  assert.equal(result.body.notes.length, 1);
  assert.equal(result.body.notes[0].body, 'Visible note');
  for (const text of ['HIDDEN NOTE', 'HIDDEN SERVER', 'HIDDEN PLAYER', 'HIDDEN CLUSTER']) assert.equal(JSON.stringify(result.body).includes(text), false);
  const list = await f.request('/player-profiles?search=HIDDEN', {
    as: 'staff'
  });
  assert.equal(list.body.total, 0);
});
test('viewer bootstrap excludes hidden servers, history, profiles and workspace-only settings', async t => {
  const f = await fixture(t);
  await f.db.prepare('UPDATE servers SET notes=? WHERE id=?').run('HIDDEN NOTES', f.hidden.id);
  await f.join();
  const result = await f.request('/bootstrap', {
    as: 'staff'
  });
  assert.equal(result.body.access.role, 'viewer');
  assert.deepEqual(result.body.servers.map(s => s.id), [f.allowed.id]);
  assert.equal(JSON.stringify(result.body).includes('HIDDEN'), false);
  assert.equal(result.body.notifications.items.length, 0);
  assert.equal(result.body.hosting_links.length, 0);
  assert.equal(result.body.integrations.billing, false);
});
test('viewer cannot mutate through direct API calls, including mixed bulk targets', async t => {
  const f = await fixture(t);
  await f.join();
  const calls = f.calls.length;
  for (const [method, path, body] of [['POST', '/servers/' + f.allowed.id + '/actions', {
    action: 'save'
  }], ['PATCH', '/servers/' + f.allowed.id, {
    name: 'Changed'
  }], ['POST', '/servers/bulk-actions', {
    server_ids: [f.allowed.id, f.hidden.id],
    action: 'save'
  }], ['POST', '/moderation', {
    server_id: f.allowed.id,
    identifier: eos,
    action: 'ban',
    reason: 'Denied'
  }], ['PATCH', '/workspace', {
    name: 'Denied'
  }], ['POST', '/billing/checkout', {
    plan: 'cluster'
  }], ['PATCH', '/ban-directory/preferences', {
    sharing_enabled: true,
    public_name: 'Denied'
  }], ['POST', '/team/invitations', {
    discord_user_id: ids.other,
    role: 'admin',
    server_ids: null
  }], ['POST', '/notifications/read-all', {}]]) {
    const result = await f.request(path, {
      as: 'staff',
      method,
      body
    });
    assert.equal(result.status, 403, path);
  }
  assert.equal(f.calls.length, calls);
});
test('moderator can act on allowed players but cannot issue hidden-server commands or change hosting/team settings', async t => {
  const f = await fixture(t);
  await f.join('moderator');
  assert.equal((await f.request('/servers/' + f.allowed.id + '/actions', {
    as: 'staff',
    method: 'POST',
    body: {
      action: 'save'
    }
  })).status, 200);
  const count = f.calls.length;
  assert.equal((await f.request('/servers/bulk-actions', {
    as: 'staff',
    method: 'POST',
    body: {
      server_ids: [f.allowed.id, f.hidden.id],
      action: 'save'
    }
  })).status, 404);
  assert.equal(f.calls.length, count);
  assert.equal((await f.request('/moderation', {
    as: 'staff',
    method: 'POST',
    body: {
      server_id: f.allowed.id,
      identifier: eos,
      action: 'ban',
      reason: 'Staff action'
    }
  })).status, 200);
  assert.equal((await f.db.prepare("SELECT actor FROM moderation WHERE action='ban'").get()).actor, 'staff');
  assert.equal((await f.request('/servers/' + f.allowed.id + '/hosting', {
    as: 'staff',
    method: 'PUT',
    body: {}
  })).status, 403);
  assert.equal((await f.request('/team', {
    as: 'staff'
  })).status, 403);
  assert.equal((await f.request('/analytics?server_id=' + f.hidden.id, {
    as: 'staff'
  })).status, 404);
});
test('scoped admin cannot change a task or window that touches a hidden server', async t => {
  const f = await fixture(t);
  const task = await f.service.addSchedule('w-owner', {
      name: 'Hidden task',
      server_id: f.hidden.id,
      action: 'save',
      interval_minutes: 60
    }),
    ownTask = await f.service.addSchedule('w-owner', {
      name: 'Own task',
      server_id: f.allowed.id,
      action: 'save',
      interval_minutes: 60
    });
  await f.join('admin');
  assert.equal((await f.request('/schedules/' + task.id + '/history', {
    as: 'staff'
  })).status, 404);
  assert.equal((await f.request('/schedules/' + ownTask.id, {
    as: 'staff',
    method: 'PATCH',
    body: {
      name: 'Move',
      server_id: f.hidden.id,
      action: 'save',
      interval_minutes: 60
    }
  })).status, 404);
  assert.equal((await f.request('/servers/' + f.allowed.id, {
    as: 'staff',
    method: 'PATCH',
    body: {
      name: 'Renamed'
    }
  })).status, 200);
  assert.equal((await f.request('/servers', {
    as: 'staff',
    method: 'POST',
    body: {}
  })).status, 403);
  assert.equal((await f.request('/templates', {
    as: 'staff',
    method: 'POST',
    body: {
      name: 'No',
      body: 'Denied'
    }
  })).status, 403);
});
test('revoking membership or narrowing scope takes effect on the next request in an existing session', async t => {
  const f = await fixture(t);
  const member = await f.join('admin', null);
  await f.team.update('w-owner', member.id, {
    role: 'viewer',
    server_ids: [f.allowed.id]
  }, {
    id: ids.owner,
    name: 'Owner'
  });
  assert.equal((await f.request('/analytics?server_id=' + f.hidden.id, {
    as: 'staff'
  })).status, 404);
  assert.equal((await f.request('/servers/' + f.allowed.id + '/actions', {
    as: 'staff',
    method: 'POST',
    body: {
      action: 'save'
    }
  })).status, 403);
  await f.team.remove('w-owner', member.id, {
    id: ids.owner,
    name: 'Owner'
  });
  assert.equal((await f.request('/bootstrap', {
    as: 'staff'
  })).status, 403);
  const next = await f.request('/bootstrap', {
    as: 'staff'
  });
  assert.equal(next.body.workspace.id, 'w-staff');
  assert.equal(next.body.servers.length, 0);
});
test('invitations are target-bound, single use, expiring, revocable, hashed at rest and CSRF protected', async t => {
  const f = await fixture(t);
  const value = {
    discord_user_id: ids.staff,
    role: 'viewer',
    server_ids: [f.allowed.id]
  };
  let invite = await f.team.invite('w-owner', value, {
      id: ids.owner,
      name: 'Owner'
    }, 'http://localhost:3000'),
    token = invite.url.split('#invite=')[1];
  assert.notEqual((await f.db.prepare('SELECT token_hash FROM team_invitations WHERE id=?').get(invite.id)).token_hash, token);
  assert.equal((await f.request('/team/invitations/preview', {
    as: 'other',
    method: 'POST',
    body: {
      token
    }
  })).status, 403);
  assert.equal((await f.request('/team/invitations/accept', {
    as: 'staff',
    method: 'POST',
    body: {
      token
    },
    headers: {
      'X-CSRF-Token': ''
    }
  })).status, 403);
  assert.equal((await f.request('/team/invitations/preview', {
    as: 'staff',
    method: 'POST',
    body: {
      token
    }
  })).body.workspace, 'owner workspace');
  await f.team.revoke('w-owner', invite.id, {
    id: ids.owner,
    name: 'Owner'
  });
  assert.equal((await f.request('/team/invitations/accept', {
    as: 'staff',
    method: 'POST',
    body: {
      token
    }
  })).status, 410);
  invite = await f.team.invite('w-owner', value, {
    id: ids.owner,
    name: 'Owner'
  }, 'http://localhost:3000');
  token = invite.url.split('#invite=')[1];
  assert.equal((await f.request('/team/invitations/accept', {
    as: 'staff',
    method: 'POST',
    body: {
      token
    }
  })).status, 200);
  assert.equal((await f.request('/team/invitations/accept', {
    as: 'staff',
    method: 'POST',
    body: {
      token
    }
  })).status, 410);
});
test('staff seats include pending invites and downgrades pause members without deleting them', async t => {
  const f = await fixture(t);
  await f.join('viewer');
  for (const discord_user_id of ['423456789012345678', '523456789012345678']) await f.team.invite('w-owner', {
    discord_user_id,
    role: 'viewer',
    server_ids: null
  }, {
    id: ids.owner,
    name: 'Owner'
  }, 'http://localhost:3000');
  await assert.rejects(async () => await f.team.invite('w-owner', {
    discord_user_id: ids.other,
    role: 'viewer',
    server_ids: null
  }, {
    id: ids.owner,
    name: 'Owner'
  }, 'http://localhost:3000'), /3 staff seats/);
  await f.db.prepare("UPDATE workspaces SET subscription_status='canceled' WHERE id='w-owner'").run();
  assert.equal(await f.team.access('w-owner', ids.staff), null);
  assert.equal((await f.team.summary('w-owner')).members[0].paused, true);
  assert.equal((await f.team.access('w-owner', ids.owner)).role, 'owner');
  assert.equal((await f.request('/bootstrap', {
    as: 'staff'
  })).status, 403);
});
test('private player notes enforce authorship, scope, role and audit without leaking into shared ban lookup', async t => {
  const f = await fixture(t);
  const member = await f.join('moderator'),
    id = (await f.profiles.list('w-owner', {
      search: eos
    })).items[0].id;
  const added = await f.request('/player-profiles/' + id + '/notes', {
    as: 'staff',
    method: 'POST',
    body: {
      server_id: f.allowed.id,
      body: 'PRIVATE NOTE BODY'
    }
  });
  assert.equal(added.status, 201);
  assert.equal((await f.request('/player-profiles/' + id + '/notes', {
    as: 'staff',
    method: 'POST',
    body: {
      server_id: f.hidden.id,
      body: 'Denied'
    }
  })).status, 404);
  assert.equal((await f.request('/player-profiles/' + id + '/notes/' + added.body.id, {
    as: 'staff',
    method: 'PATCH',
    body: {
      body: 'PRIVATE EDIT'
    }
  })).status, 200);
  const audit = (await f.team.summary('w-owner')).audit;
  assert.equal(audit.some(row => row.actor === 'staff' && row.action === 'Edited private player note'), true);
  assert.equal(JSON.stringify(audit).includes('PRIVATE EDIT'), false);
  assert.equal(JSON.stringify(createBanDirectory(f.db).lookup('w-other', {
    identifier: eos
  })).includes('PRIVATE'), false);
  await f.team.update('w-owner', member.id, {
    role: 'viewer',
    server_ids: [f.allowed.id]
  }, {
    id: ids.owner,
    name: 'Owner'
  });
  assert.equal((await f.request('/player-profiles/' + id + '/notes/' + added.body.id, {
    as: 'staff',
    method: 'DELETE'
  })).status, 403);
});
test('workspace switching rejects guessed workspaces and preserves distinct selected workspaces per session', async t => {
  const f = await fixture(t);
  await f.join('viewer');
  assert.equal((await f.request('/workspaces/switch', {
    as: 'staff',
    method: 'POST',
    body: {
      workspace_id: 'w-other'
    }
  })).status, 404);
  assert.equal((await f.request('/workspaces/switch', {
    as: 'staff',
    method: 'POST',
    body: {
      workspace_id: 'w-staff'
    }
  })).status, 200);
  assert.equal((await f.request('/bootstrap', {
    as: 'staff'
  })).body.workspace.id, 'w-staff');
  assert.equal((await f.request('/bootstrap')).body.workspace.id, 'w-owner');
  assert.equal((await f.request('/workspaces', {
    as: 'staff'
  })).body.length, 2);
});
