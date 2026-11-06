-- Preserve versioned ARK patches and allow native-format manual exports.
ALTER TABLE config_templates DROP CONSTRAINT config_templates_game_check;
ALTER TABLE config_templates DROP CONSTRAINT config_templates_filename_check;
ALTER TABLE config_templates ADD CONSTRAINT config_templates_game_file_check CHECK (
 (game IN ('asa','ase') AND filename IN ('Game.ini','GameUserSettings.ini')) OR
 (game='minecraft' AND filename='server.properties') OR
 (game='dayz' AND filename='serverDZ.cfg')
);
