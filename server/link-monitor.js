export function createLinkMonitor(db, operations, members) {
  const active = new Map();
  const polling = new Map();
  let stopped = false;
  const pollChat = async connection => {
    if (stopped || !active.has(connection.server_id) || polling.has(connection.server_id)) return;
    polling.set(connection.server_id, true);
    try {
      const result = await operations.serverChat(connection.server_id);
      if (typeof result?.output === 'string') {
        for (const line of result.output.split(/\r?\n/).map(value => value.trim()).filter(Boolean)) {
          if (!/(?:^|\s)\/link\s+[A-Za-z0-9-]+(?:\s|$)/i.test(line)) continue;
          console.log(`Account-link RCON chat candidate for ${connection.server_id}: ${line.slice(0, 300)}`);
          const outcome = await members.ingestServerChat(connection.server_id, line);
          console.log(`Account-link RCON chat result for ${connection.server_id}: ${outcome.linked ? 'linked' : 'ignored'}.`);
        }
      }
    } catch (error) {
      if (error.status !== 400 && error.status !== 404 && error.status !== 409) {
        console.error(`Account-link chat polling failed for ${connection.server_id}: ${error.message}`);
      }
    } finally {
      polling.delete(connection.server_id);
    }
  };
  const connect = async connection => {
    if (stopped || active.has(connection.server_id)) return;
    try {
      let close;
      const onLine = line => members.ingestServerChat(connection.server_id, line).catch(error => {
        if (error.status !== 400 && error.status !== 404) console.error(`Account-link event failed for ${connection.server_id}: ${error.message}`);
      });
      const onClose = () => {
        if (active.get(connection.server_id) === close) active.delete(connection.server_id);
        if (!stopped) setTimeout(() => void connect(connection), 1000);
      };
      close = await operations.hostingConsole(connection.server_id, onLine, onClose);
      active.set(connection.server_id, close);
      void pollChat(connection);
      console.log(`Account-link console stream connected for ${connection.server_id}.`);
    } catch (error) {
      console.error(`Account-link console stream unavailable for ${connection.server_id}: ${error.message}`);
    }
  };
  const sync = async () => {
    if (stopped) return;
    const connections = await db.prepare('SELECT server_id,provider,origin,remote_id,api_key FROM hosting_connections').all();
    for (const connection of connections) await connect(connection);
  };
  void sync().catch(error => console.error(`Account-link monitor failed: ${error.message}`));
  const timer = setInterval(() => void sync().catch(error => console.error(`Account-link monitor failed: ${error.message}`)), 30000);
  const chatTimer = setInterval(() => {
    for (const connection of active.keys()) void pollChat({ server_id: connection });
  }, 3000);
  return {
    stop() {
      stopped = true;
      clearInterval(timer);
      clearInterval(chatTimer);
      for (const close of active.values()) close();
      active.clear();
      polling.clear();
    }
  };
}
