# Rookrift identity

**Name:** Rookrift. A rook suggests a watchful keeper; a rift hints at the survival worlds your communities inhabit. The name stays independent of ARK so future DayZ support belongs naturally. This is a working product name, not a claim of registration or exclusive trademark rights.

**Tagline:** Your servers. Under control.

**Voice:** Calm, capable, direct. The community's worlds and time are the focus. Avoid imaginary uptime guarantees, fabricated social proof, and features that are not implemented.

**Palette:** lime `#C4F56A`, charcoal `#151815`, sidebar `#111410`, panel `#1C201B`, off-white `#E9EDE5`, muted sage `#8B9486`. Typography: Manrope for headings, DM Sans for interface text. Fonts are locally hosted under the SIL Open Font License.

## Assets

- `branding/rookrift-logo-master.png`: generated transparent source mark.
- `public/brand/rookrift-logo.png`: production 512px transparent logo.
- `public/brand/favicon-32.png`, `favicon-64.png`, `favicon-512.png`: square logo derivatives.
- `public/favicon.ico`: 32px PNG-backed ICO.
- `public/brand/apple-touch-icon.png`: 180px touch icon.
- `branding/island-master.png`: generated landscape source.
- `public/island.webp`: compressed dashboard panorama. Server cards use art-directed crops of this illustration; they are not screenshots of their labeled maps.

The rook/rift mark is combined with the lowercase wordmark in the interface. Preserve its transparent background and generous margin. The supplied favicon derivatives come from the generated mark, not from a substitute icon.

## Generation record

Both masters used the **built-in image generation tool**, not the API/CLI fallback. Derivatives were resized and converted with Sharp. Exact generation prompts are in `branding/prompts.json`.

Logo prompt: “Use case: logo-brand. Asset type: production logo icon for Rookrift, a premium survival game server management service and Discord bot. Create a single bold geometric rook chess castle emblem with a central angular rift cut-out, strong symmetrical silhouette, clean flat vector-like graphic, no text or letters, solid acid lime #c4f56a foreground. Square composition, emblem fills 76 percent of the image, generous clear edge margin. Truly transparent background. Minimal, distinctive, exceptionally legible at favicon sizes. No mockup, no shadows, no gradients, no outline border.”

Landscape prompt: “Use case: stylized-concept. Asset type: wide panoramic header artwork for a premium survival game server dashboard called Rookrift. Cinematic photorealistic prehistoric island, towering fern-covered cliffs on the left, huge distant alien obelisk as narrow pale vertical shape in the right background, a small pterosaur soaring in warm mist above lush dark conifer forest and emerald sea, golden sunset rim light. Wide 3:1 panoramic composition, atmospheric muted olive, charcoal, sage and cream tones. Beautiful AAA game environment concept art, grounded and majestic, no text, no logo, no interface. Darker left foreground with natural negative space for white text overlay.”
