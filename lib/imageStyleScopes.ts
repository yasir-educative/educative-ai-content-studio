// Where an image style is used.
//
// Node-free so the settings page can render the list without pulling the
// store — and the disk access behind it — into the client bundle.

/**
 * 'educative' is the Images page's own generator, and keeps its original name
 * so defaults saved before the other scopes existed still resolve.
 */
export type StyleScope = 'educative' | 'blog' | 'mobile' | 'course';

export const STYLE_SCOPES: Array<{ scope: StyleScope; label: string; hint: string }> = [
  { scope: 'blog', label: 'Blogs and newsletters', hint: 'Images inside a generated blog or newsletter.' },
  { scope: 'mobile', label: 'Mobile shorts and courses', hint: 'Every mobile card illustration.' },
  { scope: 'course', label: 'Courses', hint: 'Illustrations inside a generated Educative course lesson.' },
  { scope: 'educative', label: 'This page', hint: 'Images you create or edit here by hand.' },
];
