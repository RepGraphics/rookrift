import { mkdir, writeFile } from 'node:fs/promises';
await mkdir('public/fonts', { recursive: true });
for (const [family, filename] of [['DM Sans', 'dm-sans'], ['Manrope', 'manrope']]) {
  const response = await fetch(`https://fonts.googleapis.com/css2?family=${family.replaceAll(' ', '+')}:wght@400..800&display=swap`, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36' } });
  if (!response.ok) throw new Error('Font stylesheet download failed.');
  const css = await response.text();
  const url = [...css.matchAll(/url\((https:[^)]+)\)/g)].at(-1)?.[1];
  if (!url) throw new Error('Font URL not found.');
  const font = await fetch(url); if (!font.ok) throw new Error('Font download failed.');
  await writeFile(`public/fonts/${filename}.woff2`, Buffer.from(await font.arrayBuffer()));
  const license = await fetch(`https://raw.githubusercontent.com/google/fonts/main/ofl/${filename.replaceAll('-', '')}/OFL.txt`);
  if (!license.ok) throw new Error('Font license download failed.');
  await writeFile(`public/fonts/${filename}-LICENSE.txt`, await license.text());
}
console.log('Fonts saved locally.');
