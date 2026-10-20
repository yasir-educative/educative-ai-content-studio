// Fixed house style prepended to every Educative image generation.
//
// Kept free of node imports so the generator page can show it read-only.
// The request sent to the model is this block followed by the user's
// "# Create" instructions.

export const EDUCATIVE_IMAGE_STYLE = `# Mandatory visual style
- NO title, heading, subtitle, caption, even if asked
- Style: 2D editorial vector, softly inflated compact objects; playful, polished; never flat icons, SaaS/UI art, clay, plush, 3D
- Forms: crisp silhouettes, rounded curves; tech geometry clean, never floppy, blobby, overbuilt
- Stroke: thin even #223656 outline on contours and details; inner color/highlight patches unoutlined
- Layering: EVERY object: flat base + one clearly separate darker same-family curved patch for volume + optional small pale upper-left highlight; keep visible layered color shapes, never single-color icons
- Effects: solid fills only; no gradients, shading, shadows, glow, blur, reflections, bevels, fades
- Objects: ONE bold freestanding object per concept, clear volume; never on circles, tiles, backplates; no badge overlays, extra props, thin glyphs
- People: big rounded head, hair, peach skin, curved torso, no face; never tiny
- Palette: only #f36792 #fe877b #ffc3b3 #f05b30 #fa7532 #fff2e5 #feb13d #fdda84 #fefc8b #ffffee #fafb33 #a7de94 #049706 #83d689 #27b292 #91dece #9ecfd4 #c7eeff #51b5f2 #0277ca #3382bb #b5d8fe #192e58 #223656 #777df5 #8c50b6 #e2a8dc #fad0ec #fe77b8 #ff92ba; few per image
- Arrows: thin smooth #223656, lighter than outlines
- Text: sans-serif, pure #000000 only, incl. code; beside/below objects, never in pills, badges, bubbles, fills
- Labels: ONE 1–3 word label each; no sub-labels, descriptions, lists, repeats
- Casing: sentence case: capitalize first letter only, except proper nouns/abbreviations ("offline mode" → "Offline mode", "API Gateway" → "API gateway"); never all-lowercase or Title Case; code exact
- Language: text in {{content_language_name}}
- Containers: no decorative cards, frames, label backgrounds, card rows, summary strips; structural only if needed
- Borders: ANY box, group, bracket, callout: thin solid #000000 border; never borderless, dashed, colored, same-hue, overrides input
- Highlights: one #fff2e5 box, thin solid #000000 border, same legend swatch; never nested/double boxes
- Background: white #FFFFFF or transparent
- Layout: requested structure, balanced whitespace`;

export const IMAGE_MODELS = ['gpt-image-2.5-flare', 'gpt-image-2', 'gpt-image-1'] as const;
export const IMAGE_QUALITIES = ['low', 'medium', 'high'] as const;
export const IMAGE_FORMATS = ['png', 'jpeg', 'webp'] as const;

// Constraints the API enforces on width/height.
export const SIZE_RULES = {
  multiple: 16,
  minPixels: 655_360,
  maxEdge: 3840,
  maxAspect: 3,
};

export interface SizeCheck {
  label: string;
  ok: boolean;
}

/** The validation badges shown under the width/height inputs. */
export function checkSize(width: number, height: number): { checks: SizeCheck[]; valid: boolean } {
  const checks: SizeCheck[] = [
    { label: `Width multiple of ${SIZE_RULES.multiple}`, ok: width > 0 && width % SIZE_RULES.multiple === 0 },
    { label: `Height multiple of ${SIZE_RULES.multiple}`, ok: height > 0 && height % SIZE_RULES.multiple === 0 },
    { label: `Min pixels (${SIZE_RULES.minPixels.toLocaleString()})`, ok: width * height >= SIZE_RULES.minPixels },
    { label: `Max edge ≤ ${SIZE_RULES.maxEdge.toLocaleString()}px`, ok: width <= SIZE_RULES.maxEdge && height <= SIZE_RULES.maxEdge },
    {
      label: `Aspect ratio ≤ ${SIZE_RULES.maxAspect}:1`,
      ok: width > 0 && height > 0 && Math.max(width / height, height / width) <= SIZE_RULES.maxAspect,
    },
  ];
  return { checks, valid: checks.every((c) => c.ok) };
}

/** The exact string sent to the model: house style, then the user's instructions. */
export function buildEducativeImagePrompt(createInstructions: string): string {
  return `${EDUCATIVE_IMAGE_STYLE}\n\n# Create\n${createInstructions.trim()}`;
}
