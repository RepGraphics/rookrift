import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:net';
import { once } from 'node:events';
import { createVault } from '../server/crypto.js';
import { runRcon } from '../server/games.js';
import { sourceRcon } from '../server/source-rcon.js';
test('ARK adapter authenticates and handles fragmented TCP RCON responses', async t => {
  const commands = [], sockets = new Set();
  const packet = (id, type, text) => { const body = Buffer.from(text); const buf = Buffer.alloc(body.length + 14); buf.writeInt32LE(body.length + 10, 0); buf.writeInt32LE(id, 4); buf.writeInt32LE(type, 8); body.copy(buf, 12); return buf; };
  const server = createServer(socket => {
    sockets.add(socket); socket.on('close', () => sockets.delete(socket)); let pending = Buffer.alloc(0);
    socket.on('data', chunk => {
      pending = Buffer.concat([pending, chunk]);
      while (pending.length >= 4 && pending.length >= pending.readInt32LE(0) + 4) {
        const length = pending.readInt32LE(0), request = pending.subarray(0, length + 4); pending = pending.subarray(length + 4);
        const id = request.readInt32LE(4), type = request.readInt32LE(8), text = request.subarray(12, -2).toString();
        if (type === 3) { assert.equal(text, 'test-password'); socket.write(packet(id, 2, '')); }
        else if (text) { commands.push(text); const response = packet(id, 0, '0. Survivor, 76561198000000001\n1. Bob, 76561198000000002'); socket.write(response.subarray(0, 8)); setTimeout(() => socket.write(response.subarray(8)), 5); }
        else setTimeout(() => socket.write(packet(id, 0, '')), 10);
      }
    });
  });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  const previous = process.env.ALLOW_PRIVATE_RCON; process.env.ALLOW_PRIVATE_RCON = 'true';
  t.after(() => { if (previous === undefined) delete process.env.ALLOW_PRIVATE_RCON; else process.env.ALLOW_PRIVATE_RCON = previous; for (const s of sockets) s.destroy(); server.close(); });
  const vault = createVault('a'.repeat(64));
  const response = await runRcon({ game: 'asa', host: '127.0.0.1', port: server.address().port, password: vault.encrypt('test-password') }, vault, 'players');
  assert.deepEqual(commands, ['ListPlayers']); assert.equal(response.players.length, 2); assert.ok(response.latency >= 0);
});
test('malformed RCON packet lengths are rejected without a parser loop or process failure', async t => {
  const server = createServer(socket => { socket.on('error', () => {}); const malformed = Buffer.alloc(4); malformed.writeInt32LE(-4); socket.write(malformed); });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); t.after(() => server.close());
  await assert.rejects(sourceRcon({ host: '127.0.0.1', port: server.address().port, password: 'test', command: 'ListPlayers', timeout: 1000 }), /Invalid RCON packet length/);
});
