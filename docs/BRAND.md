# Rookrift identity

**Name:** Rookrift. A rook suggests a watchful keeper; a rift hints at the survival worlds your communities inhabit. The name stays independent of ARK so future DayZ support belongs naturally. This is a working product name, not a claim of registration or exclusive trademark rights.

**Tagline:** Your servers. Under control.

**Voice:** Calm, capable, direct. The community's worlds and time are the focus. Avoid imaginary uptime guarantees, fabricated social proof, and features that are not implemented.

**Palette:** the logo retains lime `#C4F56A` as its brand mark. The interface uses a neutral workspace `#F3F5F7`, white panels, slate navigation `#202A35`, text `#293747`, and restrained green `#367763` for actions and charts. Dark mode uses graphite `#191D23`, panels `#222830`, readable grey `#E0E6ED`, and muted green `#91BAA9`. Appearance is remembered in the browser. Status colours are reserved for operational meaning. Typography: Manrope for headings, DM Sans for interface text. Fonts are locally hosted under the SIL Open Font License. Standard interface text is 13–14px, with 11–12px supporting labels; content does not shrink at wider desktop sizes.

## Assets

- `branding/rookrift-logo-master.png`: generated transparent source mark.
- `public/brand/rookrift-logo.png`: production 512px transparent logo.
- `public/brand/favicon-32.png`, `favicon-64.png`, `favicon-512.png`: square logo derivatives.
- `public/favicon.ico`: 32px PNG-backed ICO.
- `public/brand/apple-touch-icon.png`: 180px touch icon.
- `branding/island-master.png`: generated landscape source.
- `public/island.webp`: compressed landscape illustration used on the sign-in page. The operational dashboard uses plain server cards and reserves visual emphasis for status and actions.

The rook/rift mark is combined with the lowercase wordmark in the interface. Preserve its transparent background and generous margin. The supplied favicon derivatives come from the generated mark, not from a substitute icon.

## Public homepage

The public landing page defaults to a restrained dark palette: graphite background `#191D23`, panels `#222830`, text `#EEF2F6`, secondary text `#ACB8C5` and muted green actions `#9DBFAE`. A header switch offers an optional warm light palette using `#F5F6F2`, white surfaces, deep green text `#202E2B` and forest-green actions `#315E4B`. The selected appearance is remembered with the same preference used by sign-in and the dashboard. Large Manrope headings and generous spacing lead into an explicitly illustrative dashboard, feature tour, setup guide, shared-plan pricing and FAQs. Product previews show example data; they do not claim customer activity or service uptime. The existing island artwork appears within product illustrations, rather than behind the reading surface.

The header and closing action lead to dedicated sign-in/registration pages, with a route back to the homepage. The preview offers a demo dashboard without collecting credentials. Pricing uses the same plan definitions as the app. Avoid fabricated testimonials, unverified savings claims and promises of unsupported game/provider actions.

## Generation record

Both masters used the **built-in image generation tool**, not the API/CLI fallback. Derivatives were resized and converted with Sharp. Exact generation prompts are in `branding/prompts.json`.

Logo prompt: “Use case: logo-brand. Asset type: production logo icon for Rookrift, a premium survival game server management service and Discord bot. Create a single bold geometric rook chess castle emblem with a central angular rift cut-out, strong symmetrical silhouette, clean flat vector-like graphic, no text or letters, solid acid lime #c4f56a foreground. Square composition, emblem fills 76 percent of the image, generous clear edge margin. Truly transparent background. Minimal, distinctive, exceptionally legible at favicon sizes. No mockup, no shadows, no gradients, no outline border.”

Landscape prompt: “Use case: stylized-concept. Asset type: wide panoramic header artwork for a premium survival game server dashboard called Rookrift. Cinematic photorealistic prehistoric island, towering fern-covered cliffs on the left, huge distant alien obelisk as narrow pale vertical shape in the right background, a small pterosaur soaring in warm mist above lush dark conifer forest and emerald sea, golden sunset rim light. Wide 3:1 panoramic composition, atmospheric muted olive, charcoal, sage and cream tones. Beautiful AAA game environment concept art, grounded and majestic, no text, no logo, no interface. Darker left foreground with natural negative space for white text overlay.”
