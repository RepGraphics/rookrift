import {open} from 'node:fs/promises';
import {stat} from 'node:fs/promises';

const path = process.env.LINK_LOG_PATH;
const endpoint = process.env.ROOKRIFT_LINK_ENDPOINT;
const token = process.env.ROOKRIFT_LINK_TOKEN;
const serverId = process.env.ROOKRIFT_SERVER_ID;
if (!path || !endpoint || !token || !serverId) throw new Error('LINK_LOG_PATH, ROOKRIFT_LINK_ENDPOINT, ROOKRIFT_LINK_TOKEN, and ROOKRIFT_SERVER_ID are required.');

let offset = 0;
let carry = '';
async function poll() {
  const info = await stat(path);
  if (info.size < offset) offset = 0;
  if (info.size === offset) return;
  const file = await open(path, 'r');
  try {
    const buffer = Buffer.alloc(info.size - offset);
    await file.read(buffer, 0, buffer.length, offset);
    offset = info.size;
    carry += buffer.toString('utf8');
  } finally {
    await file.close();
  }
  const lines = carry.split(/\r?\n/);
  carry = lines.pop() || '';
  for (const message of lines.filter(line => /(?:^|\s)\/link\s+[A-Za-z0-9-]+(?:\s|$)/i.test(line))) {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json'},
      body: JSON.stringify({server_id: serverId, message})
    });
    if (!response.ok) console.error(`Link event rejected (${response.status}).`);
  }
}
console.log(`Rookrift link agent watching ${path}.`);
setInterval(() => poll().catch(error => console.error(`Link agent poll failed: ${error.message}`)), 1000);
await poll();
