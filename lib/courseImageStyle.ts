// The visual style Educative course illustrations are drawn in.
//
// Node-free so the style picker can show it without pulling the image
// generator in. It is the shipped default for the course scope; the author can
// point that scope at any saved style instead.

export const COURSE_IMAGE_STYLE = `# Mandatory visual style

- Style: soft, gently inflated 2D editorial vector illustration; clean, playful, and shape-based, never SaaS/UI-card, generic icon-pack, clay, plush, or rendered 3D
- Forms: plump, rounded, slightly exaggerated silhouettes with smooth controlled curves; technical objects retain necessary straight edges and functional geometry but stay softened, chunky, and simplified
- Stroke: primary silhouettes and functional details use clean, consistent #223656 contours; never colored, sketchy, missing, or thick sticker-like outlines; shading and highlight patches remain unoutlined
- Volume: build dimensionality only with clearly separated flat shapes: a base fill, usually one darker same-family curved patch, and an optional small pale upper-left highlight; never use lighting to create volume
- Shading: solid palette colors only; no gradients, smooth tonal transitions, cast/drop/ground shadows, glow, blur, transparency fades, reflections, ambient shadows, beveling, or realistic lighting
- Highlights: sparse and subtle; use small cream/light curved patches on select major rounded forms only, following their curvature; never large glossy white shine or highlights on every object
- Objects: use simple, chunky, low-detail standalone illustrations with recognizable silhouettes and soft volume; avoid generic flat symbols, UI pictograms, standardized icon-library geometry, extrusion, or perspective-heavy 3D
- Detail: keep internal details sparse and chunky; prefer a few large illustrative shapes over dense circuitry, controls, or micro-details
- People: rounded heads, simple solid hair, capsule-like bodies, and curved limbs; faces remain featureless with no eyes, eyebrows, mouth, or interior facial details; a tiny nose may appear only through a side-profile silhouette
- Technical objects: monitors, servers, databases, clouds, gears, tools, charts, cubes, devices, and similar concepts remain immediately recognizable while following the same softened, simplified visual language
- Palette: use only #f36792, #fe877b, #ffc3b3, #f05b30, #fa7532, #fff2e5, #feb13d, #fdda84, #fefc8b, #ffffee, #fafb33, #a7de94, #049706, #83d689, #27b292, #91dece, #9ecfd4, #c7eeff, #51b5f2, #0277ca, #3382bb, #b5d8fe, #192e58, #223656, #777df5, #8c50b6, #e2a8dc, #fad0ec, #fe77b8, #ff92ba; use a coordinated subset of roughly 3–5 main hues per illustration
- Connectors: thin, smooth #223656 lines with simple arrowheads; solid or dashed only when conceptually useful; keep connectors visually lighter than illustrated-object contours
- Text: clean dark-navy sans-serif only; labels sit directly on the white background beside or below their objects; no handwritten, decorative, outlined, playful-display, or 3D typography
- Containers: never add decorative cards, pills, tiles, badges, colored panels, or boxes behind objects or labels; enclosing boundaries are allowed only when the boundary itself represents an actual system/component structure required by the concept
- Borders: no outer image border or decorative frame; outlines belong only to actual illustrated or structural elements
- Background: plain white or transparent with generous whitespace; no scenery, textures, gradients, decorative backdrops, floor planes, shadows, or atmospheric effects
- Composition: clean educational illustration or technical diagram with clear hierarchy, balanced spacing, standalone pictorial objects, and purposeful relationships; avoid dashboards, feature-card grids, and UI-style layouts
- Overall character: friendly, colorful, educational, softly dimensional, and slightly playful; graphic rather than rendered, simplified rather than flat, professional without becoming corporate or UI-like`;
