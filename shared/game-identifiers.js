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
  minecraft: {
    name:'Minecraft Java',summary:'Use your exact Java username for vanilla command delivery. UUID delivery requires a compatible plugin.',
    steps:['Copy the Java username shown in your Minecraft profile or the server player list.','Use 3-16 letters, numbers or underscores. Do not enter an Xbox gamertag.','If the package specifically requests a UUID, ask staff to confirm the UUID and the command/plugin they use.'],
    note:'This adapter supports Minecraft Java RCON, not Bedrock. A saved username is self-reported and does not prove account ownership.'
  },
  dayz: {
    name: 'DayZ',
    summary: 'Use the 32-character BattlEye GUID reported by this server, not your character name or Steam64 ID.',
    steps: [
      'Join the server and ask an owner or admin to check your player in the server console, BattlEye logs, or the community admin tool.',
      'Copy the exact BattlEye GUID shown for your player. This is distinct from Steam64 and the DayZ character UID.',
      'If the community uses a plugin account ID, ask staff which identifier format their delivery system expects.'
    ],
    note: 'Native BattlEye does not grant inventory items. Community staff or a compatible mod must arrange item delivery. Ask staff to confirm the required identity.'
  }
};
