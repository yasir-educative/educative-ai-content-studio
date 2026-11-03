// The look of a mobile card's illustration.
//
// Kept free of node imports so the style picker can show it read-only. This is
// only the treatment — palette, stroke, finish. The structural half of the
// prompt (portrait, label rules, the idea itself) is built in
// mobileCardImagePrompt and is not the author's to change, because the card
// renderer depends on it.

export const MOBILE_CARD_IMAGE_STYLE = `Background: white (#FFF).

Style: Flat 2D vector only. 2px uniform stroke, 8px rounded corners. Outlined shapes with white or pale tinted fill. Consistent icon size per tier. Absolutely no 3D, no perspective, no shadows, no gradients, no cartoon characters, no hand-drawn or sketch style, no textures.

Colors: Only these — #4A90D9 (blue) and #3AAFA9 (teal) as primary. #48BB78 (green) and #E6A817 (amber) sparingly as accent. All text #2D3748. No reds, no grays, no off-palette colors.

Lettering: Geometric sans-serif, medium weight.`;
