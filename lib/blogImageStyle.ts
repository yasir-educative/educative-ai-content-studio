// The visual style blog and newsletter illustrations are drawn in.
//
// This is the prompt those pipelines always used, with only the trailing
// "Inputs Illustration idea:" line removed — that line is structural and is
// appended after whichever style the author chose, so the shipped default
// produces exactly the prompt it did before.

export const BLOG_IMAGE_STYLE = `Create a clean portrait mobile-friendly image card. Use the Illustration idea as the primary source for the visual composition. Use the Content only as hidden background context to better understand the topic. Do not copy, summarize, paraphrase, or display any text from the Content in the image. The final image should be driven mainly by the illustration idea, using a clear visual explanation with simple labels, icons, arrows, or small callouts only when needed. Keep text minimal, sharp, and readable on mobile. Show only a few short labels necessary to make the illustration understandable. Do not include paragraphs or long sentences. Use about 20px white padding on all sides, not more. Keep all elements safely inside the margins. Avoid clutter.`;
