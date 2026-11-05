export const GAME_IDENTIFIER_GUIDES = {
  asa: {
    name: 'ARK: Survival Ascended',
    summary: 'Use the identifier your server reports for your character. Do not enter your display name.',
    steps: [
      'Join the server and ask an owner or admin to run ListPlayers in the server console.',
      'Copy your exact player identifier from that output. Depending on the server setup, this may be an EOS ID, Steam64 ID, or plugin account ID.',
      'If the product asks for a numeric PlayerID, an admin can run cheat GetPlayerIDForPlayerName "YourName" and give you the returned value.'
    ],
    note: 'For Steam64, open your Steam profile and copy the 17-digit ID from a trusted Steam ID lookup. For EOS, ask a server admin to copy the EOS ID shown by the server or its admin tools.'
  },
  ase: {
    name: 'ARK: Survival Evolved',
    summary: 'Use the identifier your server reports for your character. Do not enter your display name.',
    steps: [
      'Join the server and ask an owner or admin to run ListPlayers in the server console.',
      'Copy your exact player identifier from that output. Depending on the server setup, this may be an EOS ID, Steam64 ID, or plugin account ID.',
      'If the product asks for a numeric PlayerID, an admin can run cheat GetPlayerIDForPlayerName "YourName" and give you the returned value.'
    ],
    note: 'For Steam64, open your Steam profile and copy the 17-digit ID from a trusted Steam ID lookup. For EOS, ask a server admin to copy the EOS ID shown by the server or its admin tools.'
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
