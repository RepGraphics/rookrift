export function csvCell(value) {
  const text = String(value ?? '');
  // Prevent spreadsheet formula interpretation, including after leading whitespace.
  const safe = /^[\s\uFEFF]*[=+@-]/u.test(text) || /^[\t\r\n]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}
export function activityCsv(events, servers = []) {
  const names = new Map(servers.map(server => [server.id, server.name]));
  const rows = [['Time (UTC)', 'Event', 'Server', 'Details', 'Level'], ...events.map(event => [new Date(event.created_at).toISOString(), event.title, names.get(event.server_id) || '', event.detail, event.level])];
  return '\uFEFF' + rows.map(row => row.map(csvCell).join(',')).join('\r\n');
}
