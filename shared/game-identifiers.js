export const GAME_IDENTIFIER_GUIDES = {
  asa: {
    name: 'ARK: Survival Ascended',
    summary: 'ASA shop purchases use your EOS ID: 32 hexadecimal characters. Do not enter a Steam ID or display name.',
    steps: [
      'Join the server and ask an owner or admin to run ListPlayers in the server console.',
      'Copy your 32-character EOS ID from that output, or choose your saved ASA account at checkout.',
      'If the product asks for a numeric PlayerID, an admin can run cheat GetPlayerIDForPlayerName "YourName" and give you the returned value.'
    ],
    note: 'EOS identifies your ASA account. Numeric PlayerID commands require a separate character ID; EOS delivery needs a compatible command or plugin.'
  },
  ase: {
    name: 'ARK: Survival Evolved',
    summary: 'ASE shop purchases use your 17-digit Steam64 ID. Do not enter an EOS ID or display name.',
    steps: [
      'Join the server and ask an owner or admin to run ListPlayers in the server console.',
      'Copy your 17-digit Steam64 ID from that output, or choose your saved ASE account at checkout.',
      'If the product asks for a numeric PlayerID, an admin can run cheat GetPlayerIDForPlayerName "YourName" and give you the returned value.'
    ],
    note: 'A Steam64 ID identifies your Steam account. Numeric PlayerID commands require a separate character ID; Steam ID delivery needs a compatible command or plugin.'
  },
  dayz: {
    name: 'DayZ',
    summary: 'Use the player identifier shown by the server admin tools, not your character name.',
    steps: [
      'Join the server and ask an owner or admin to check your player in the server console, BattlEye logs, or the community admin tool.',
      'Copy the exact Steam64 ID or platform identifier shown for your player.',
      'If the community uses a plugin account ID, ask staff which identifier format their delivery system expects.'
    ],
    note: 'DayZ identifier formats vary by server tooling. Staff should confirm the exact value before you submit it.'
  }
};
