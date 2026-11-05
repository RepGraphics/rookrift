// Accept a whole chat command, never a /link fragment quoted inside another message.
export function chatLinkRecord(message) {
  if (typeof message !== 'string' || message.length > 4096) return null;
  const line = message.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').trim();
  if (/[\r\n\x00]/.test(line)) return null;
  const match = line.match(/^(.*):\s*\/link\s+(RR-[A-F0-9]{10,32})\s*$/i);
  if (!match) return null;
  const prefixes = new Set([match[1].trim()]);
  // Engine log prefixes are optional. Retain the original variant to detect
  // ambiguity with a player whose real account name resembles a log prefix.
  const dated = match[1].replace(/^\[\d{4}\.\d{2}\.\d{2}[- ][\d.:]+\]\[\s*\d+\]\s*/, '').trim();
  prefixes.add(dated);
  for (const prefix of [...prefixes]) prefixes.add(prefix.replace(/^\[(?:chat|global|local|serverchat)\]\s*/i, '').trim());
  return {code:match[2].toUpperCase(),prefixes:[...prefixes]};
}

export function chatLinkPlayer(record, lines) {
  if (!record || !Array.isArray(lines)) return null;
  const matches = lines.map(line => {
    const comma = String(line).lastIndexOf(',');
    return comma < 1 ? null : {name:String(line).slice(0,comma).trim(),identifier:String(line).slice(comma+1).trim()};
  }).filter(player => player?.name && record.prefixes.some(prefix => {
    const value=prefix.toLocaleLowerCase('en-US'), name=player.name.toLocaleLowerCase('en-US');
    return value===name || (value.startsWith(name+' (') && value.endsWith(')'));
  }));
  // Duplicate names, account/character ambiguity and prefix impersonation all
  // require a unique current player before a link can be verified.
  return matches.length===1 ? matches[0] : null;
}
