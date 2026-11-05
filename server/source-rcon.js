import { createConnection } from 'node:net';
const MAX_BYTES = 1024 * 1024;
function encode(id, type, text) {
  const body = Buffer.from(text, 'utf8'), packet = Buffer.alloc(body.length + 14);
  packet.writeInt32LE(body.length + 10, 0); packet.writeInt32LE(id, 4); packet.writeInt32LE(type, 8); body.copy(packet, 12);
  return packet;
}
// Source RCON uses little-endian length/id/type fields and two NUL terminators.
// Replies may span TCP chunks or multiple packets. Send an empty response marker
// after the first reply: ARK can reject a command batched with its marker. An
// idle fallback supports hosts that omit the marker response.
export function sourceRcon({ host, port, password, command, timeout = 7000 }) {
  return new Promise((resolve, reject) => {
    let pending = Buffer.alloc(0), authenticated = false, markerSent = false, done = false, bytes = 0, idle;
    const output = [];
    const socket = createConnection({ host, port });
    const deadline = setTimeout(() => finish(new Error('RCON timed out.')), timeout);
    function finish(error) {
      if (done) return; done = true; clearTimeout(deadline); clearTimeout(idle); socket.destroy();
      if (error) reject(error); else resolve(Buffer.concat(output).toString('utf8'));
    }
    socket.on('error', error => finish(error));
    socket.on('close', () => { if (!done) finish(new Error('RCON connection closed.')); });
    socket.on('connect', () => socket.write(encode(1, 3, password)));
    socket.on('data', chunk => {
      bytes += chunk.length;
      if (bytes > MAX_BYTES) { finish(new Error('RCON response exceeds the size limit.')); return; }
      pending = Buffer.concat([pending, chunk]);
      while (!done && pending.length >= 4) {
        const length = pending.readInt32LE(0);
        if (length < 10 || length > MAX_BYTES - 4) { finish(new Error('Invalid RCON packet length.')); return; }
        if (pending.length < length + 4) return;
        const packet = pending.subarray(0, length + 4); pending = pending.subarray(length + 4);
        if (packet[length + 2] !== 0 || packet[length + 3] !== 0) { finish(new Error('Invalid RCON packet terminator.')); return; }
        const id = packet.readInt32LE(4), type = packet.readInt32LE(8);
        if (id === -1) { finish(new Error('RCON authentication failed.')); return; }
        if (!authenticated && id === 1 && type === 2) {
          authenticated = true; socket.write(encode(2, 2, command));
        } else if (authenticated && id === 2 && type === 0) {
          output.push(packet.subarray(12, packet.length - 2)); clearTimeout(idle);
          if (!markerSent) { markerSent = true; socket.write(encode(3, 2, '')); }
          idle = setTimeout(() => finish(), 200);
        } else if (authenticated && id === 3 && type === 0) finish();
      }
    });
  });
}
