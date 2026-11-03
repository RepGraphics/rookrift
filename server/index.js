import { openDatabase } from './db.js';
import { createVault } from './crypto.js';
import { createService } from './service.js';
import { createBilling } from './billing.js';
import { createApp } from './app.js';
import { startBot, sendAlert } from './bot.js';
if (!process.env.APP_URL) throw new Error('APP_URL is required. Copy .env.example to .env and complete setup.');
if (process.env.NODE_ENV === 'production' && !process.env.APP_URL.startsWith('https://')) throw new Error('Production APP_URL must use HTTPS.');
const db = openDatabase(), vault = createVault(process.env.ENCRYPTION_KEY), service = createService(db, vault), billing = createBilling(db);
let bot = null;
const app = createApp({ db, vault, service, billing, getBot: () => bot });
const server = app.listen(Number(process.env.PORT || 3000), () => console.log(`Rookrift running at ${process.env.APP_URL}`));
bot = await startBot(db, service).catch(() => { console.error('Discord bot could not connect. Check its token and restart to retry.'); return null; });
let stopping = false, active = false, cycle = 0;
async function tick() {
  if (active || stopping) return; active = true;
  try {
    await service.runDueSchedules();
    await service.pollAll((ws, message) => sendAlert(bot, ws, message));
    if (cycle++ % 15 === 0) await billing.reconcile();
    db.prepare('DELETE FROM sessions WHERE expires_at<?').run(Date.now());
    db.prepare('DELETE FROM oauth_states WHERE expires_at<?').run(Date.now());
  } catch { console.error('Background cycle failed; retrying next minute.'); }
  finally { active = false; }
}
const interval = setInterval(tick, 60000); tick();
async function stop() {
  if (stopping) return; stopping = true; clearInterval(interval); server.close(); bot?.destroy();
  while (active) await new Promise(resolve => setTimeout(resolve, 100));
  db.close(); process.exit(0);
}
process.on('SIGINT', stop); process.on('SIGTERM', stop);
