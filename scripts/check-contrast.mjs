import { readFile } from 'node:fs/promises';
import assert from 'node:assert/strict';
const source = await readFile('src/styles.css', 'utf8');
const tokens = block => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f0-9]{6})\s*;/gi)].map(([, name, color]) => [name, color]));
const light = tokens(source.match(/:root\s*\{([^}]+)\}/)[1]);
const dark = { ...light, ...tokens(source.match(/:root\[data-theme='dark'\]\s*\{([^}]+)\}/)[1]) };
function luminance(color) {
  const channels = color.slice(1).match(/../g).map(hex => parseInt(hex, 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
}
const ratio = (a, b) => (Math.max(luminance(a), luminance(b)) + .05) / (Math.min(luminance(a), luminance(b)) + .05);
const pairs = [['text','panel'],['text','bg'],['heading','panel'],['muted','panel'],['muted','bg'],['soft','panel'],['accent','panel'],['accent','accent-soft'],['on-primary','primary'],['success','success-bg'],['warning','warning-bg'],['danger','danger-bg'],['info','info-bg'],['sidebar-text','sidebar'],['sidebar-muted','sidebar']];
for (const [name,palette] of Object.entries({ light, dark })) {
  const results = pairs.map(([foreground,background]) => {
    const value = ratio(palette[foreground], palette[background]);
    assert.ok(value >= 4.5, `${name}: ${foreground} on ${background} is ${value.toFixed(2)}:1`);
    return value;
  });
  console.log(`${name}: ${results.length} text pairs pass 4.5:1; lowest ${Math.min(...results).toFixed(2)}:1.`);
}
const landingSource=await readFile('src/landing-page.css','utf8');
const landing=tokens(landingSource.match(/\.landing-page\s*\{([^}]+)\}/)[1]);
const landingPairs=[['lp-ink','lp-bg'],['lp-ink','lp-paper'],['lp-muted','lp-bg'],['lp-muted','lp-paper'],['lp-muted','lp-soft'],['lp-green','lp-bg'],['lp-green','lp-soft']];
const landingResults=landingPairs.map(([foreground,background])=>{const value=ratio(landing[foreground],landing[background]);assert.ok(value>=4.5,`landing: ${foreground} on ${background} is ${value.toFixed(2)}:1`);return value;});
const landingButton=ratio('#ffffff',landing['lp-green']);assert.ok(landingButton>=4.5,'landing: button text must pass 4.5:1');
console.log(`landing: ${landingPairs.length+1} text/button pairs pass 4.5:1; lowest ${Math.min(...landingResults,landingButton).toFixed(2)}:1.`);
