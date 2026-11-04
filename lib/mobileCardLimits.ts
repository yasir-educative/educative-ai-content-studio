import { isCardType, isHighlightCardType, normalizeScenarioCardType, scenarioHeadings, type MobileCardType } from './mobileCardTypes';
import type { MobileCard } from './mobileCourseStorage';

export interface FieldLimit {
  field: string;
  label: string;
  min: number;
  max: number;
  target?: [number, number];
}

// Scenario entries describe the repeated sections and the final takeaway respectively.
export const CARD_LIMITS: Partial<Record<MobileCardType, FieldLimit[]>> = {
  text: [{ field: 'text', label: 'Text', min: 350, max: 420, target: [350, 420] }],
  text_img: [{ field: 'text', label: 'Text', min: 230, max: 260, target: [230, 260] }],
  highlightCard: [{ field: 'text', label: 'Highlight', min: 100, max: 130, target: [100, 130] }],
  scenarioCard: [
    { field: 'sections[i].content', label: 'Section', min: 100, max: 130, target: [100, 130] },
    { field: 'sections[last].content', label: 'Takeaway', min: 200, max: 230, target: [200, 230] },
  ],
};

export type CardProduct = 'short' | 'course';

export const COURSE_CARD_LIMITS = {
  ...CARD_LIMITS,
  text: [{ field: 'text', label: 'Text', min: 350, max: 450, target: [350, 450] }],
  text_img: [{ field: 'text', label: 'Text', min: 240, max: 280, target: [240, 280] }],
  scenarioCard: [
    { field: 'sections[i].content', label: 'Section', min: 100, max: 130, target: [100, 130] },
    { field: 'sections[last].content', label: 'Takeaway', min: 200, max: 230, target: [200, 230] },
  ],
} satisfies Partial<Record<MobileCardType, FieldLimit[]>>;

export interface LimitIssue {
  cardId: string;
  cardNumber?: number;
  field: string;
  path: string;
  length: number;
  min: number;
  max: number;
  severity: 'error' | 'warning';
  message: string;
}

export function checkCard(card: MobileCard, product: CardProduct = 'short'): LimitIssue[] {
  if (card.readOnly) return [];
  const issues: LimitIssue[] = [];
  const issue = (path: string, message: string, length = 0, min = 0, max = 0, severity: 'error' | 'warning' = 'error') => {
    issues.push({ cardId: card.id, cardNumber: card.card_number, field: path, path, length, min, max, severity, message });
  };
  const text = (path: string, value: unknown, label: string, min = 0, max = Infinity, required = true) => {
    const str = typeof value === 'string' ? value : '';
    if (!str.trim()) {
      if (required) issue(path, `${label} is required`, str.length, min, max);
      else if (str.length > max) issue(path, `${label}: ${str.length} > ${max} characters`, str.length, min, max);
    } else if (str.length > max) issue(path, `${label}: ${str.length} > ${max} characters`, str.length, min, max);
    else if (str.length < min) issue(path, `${label}: ${str.length} < ${min} characters`, str.length, min, max, 'warning');
  };
  const count = (path: string, value: unknown[], label: string, min: number, max = Infinity) => {
    if (value.length < min || value.length > max) issue(path, `${label}: ${value.length} items; expected ${min}${max === min ? '' : `–${max === Infinity ? 'or more' : max}`}`, value.length, min, max);
  };
  if (!isCardType(card.type) || card.typeWarning) issue('type', 'Card type could not be recognised — regenerate or change the type');
  if (!['quiz', 'trueFalseCard', 'fillInTheBlank', 'highlightCard'].includes(card.type)) {
    text('title', card.title, 'Title');
    const words = (card.title || '').trim().split(/\s+/).filter(Boolean).length;
    if (words > 5) issue('title', `Title: ${words} > 5 words`, words, 2, 5);
    else if (words > 0 && words < 2) issue('title', `Title: ${words} < 2 words`, words, 2, 5, 'warning');
  }
  const limits = (product === 'course' ? COURSE_CARD_LIMITS : CARD_LIMITS)[card.type];
  if (['text', 'text_img', 'highlightCard'].includes(card.type)) {
    const limit = limits![0];
    text('text', card.text, limit.label, limit.min, limit.max);
  }
  if (card.type === 'text_img' || card.type === 'img_only') {
    text('imageUrl', card.imageUrl, 'Image');
    text('illustration_idea', card.illustration_idea, 'Illustration idea');
    const labels = String(card.visible_labels || '').split(',').filter((label) => label.trim());
    count('visible_labels', labels, 'Visible labels', 0, 6);
    if (card.type === 'img_only') text('img_context', card.img_context, 'Image context');
  }
  if (card.type === 'highlightCard' && !isHighlightCardType(card.highlightCardType)) issue('highlightCardType', 'Highlight type is not selected');
  if (card.type === 'highlightCard' && /[*#`]|^\s*(>|- )/m.test(card.text || '')) issue('text', 'Highlight: markdown is not allowed');
  if (card.type === 'text-with-code') {
    text('text_1', card.text_1, 'Text 1', 150, 170);
    text('text_2', card.text_2, 'Text 2', 150, 170, false);
  }
  if (card.type === 'text-with-code' || card.type === 'code-with-output') text('code', card.code, 'Code');
  if (card.type === 'code-with-output' && card.output_available === true) text('output', card.output, 'Output');
  if (card.type === 'comparisonCards') {
    for (const side of ['leftOption', 'rightOption'] as const) {
      text(`${side}.label`, card[side]?.label, `${side === 'leftOption' ? 'Left' : 'Right'} label`);
      text(`${side}.description`, card[side]?.description, `${side === 'leftOption' ? 'Left' : 'Right'} description`, 250, 300);
    }
  }
  if (card.type === 'scenarioCard') {
    const sections = Array.isArray(card.sections) ? card.sections : [];
    count('sections', sections, 'Scenario sections', 3, 3);
    // The variant owns the three tab headings, so an unset variant leaves the
    // card unlabelled — the same blocker a highlight with no type gets.
    // A card saved before the variants were fixed carries the headings and no
    // id; those headings name the variant, so read it back rather than blocking.
    const resolved = normalizeScenarioCardType(card.scenarioType, sections);
    const headings = scenarioHeadings(resolved);
    if (!resolved) issue('scenarioType', 'Scenario type is not selected');
    sections.forEach((section, i) => {
      text(`sections[${i}].heading`, section?.heading, `Section ${i + 1} heading`);
      if (headings && i < headings.length && section?.heading && section.heading !== headings[i]) {
        issue(`sections[${i}].heading`, `Section ${i + 1} heading should be "${headings[i]}" for this scenario type`, 0, 0, 0, 'warning');
      }
      const limit = limits![i < 2 ? 0 : 1];
      text(`sections[${i}].content`, section?.content, `Section ${i + 1} content`, limit.min, limit.max);
    });
  }
  const options = Array.isArray(card.options) ? card.options : [];
  if (card.type === 'quiz') {
    text('question', card.question, 'Quiz question', 0, 190);
    count('options', options, 'Quiz options', 3, 4);
    options.forEach((option, i) => text(`options[${i}].text`, typeof option === 'object' ? option?.text : undefined, `Quiz option ${i + 1}`, 0, 30));
    if (card.correctAnswer === undefined || !options.some((o) => typeof o === 'object' && o?.id === card.correctAnswer)) issue('correctAnswer', 'Correct answer must equal a quiz option id');
  }
  if (card.type === 'trueFalseCard' || card.type === 'fillInTheBlank') text('question', card.question, 'Question', 120, 180);
  if (card.type === 'trueFalseCard' && card.correctAnswer !== 'true' && card.correctAnswer !== 'false') issue('correctAnswer', 'Correct answer must be true or false');
  if (card.type === 'fillInTheBlank') {
    const blanks = (card.question || '').match(/_blank_/g)?.length || 0;
    if (!blanks) issue('question', 'Question must contain _blank_');
    count('options', options, 'Blank options', 2);
    options.forEach((o, i) => text(`options[${i}]`, o, `Blank option ${i + 1}`));
    const answers = Array.isArray(card.correctOptions) ? card.correctOptions : [];
    count('correctOptions', answers, 'Correct options', Math.max(1, blanks), Math.max(1, blanks));
    answers.forEach((answer, i) => {
      if (!answer?.trim() || !options.includes(answer as never)) issue(`correctOptions[${i}]`, `Correct option ${i + 1} must match an option`);
    });
  }
  if (card.type === 'recapCard') {
    const items = Array.isArray(card.content) ? card.content : [];
    count('content', items, 'Recap items', product === 'course' ? 5 : 1, product === 'course' ? 6 : Infinity);
    items.forEach((item, i) => {
      text(`content[${i}].heading`, item?.heading, `Recap item ${i + 1} heading`);
      text(`content[${i}].text`, item?.text, `Recap item ${i + 1} text`, 120, 180);
    });
  }
  return issues;
}

export function checkCards(cards: MobileCard[], product: CardProduct = 'short'): { issues: LimitIssue[]; blocking: boolean } {
  const issues = cards.flatMap((card) => checkCard(card, product));
  return { issues, blocking: issues.some((issue) => issue.severity === 'error') };
}

// Collection titles are published even when publishing only one chapter.
export function checkCourse(courseName: string, cards: MobileCard[]): { issues: LimitIssue[]; blocking: boolean } {
  const result = checkCards(cards, 'course');
  if (!courseName.trim() || courseName.length > 60) {
    result.issues.unshift({
      cardId: 'course', field: 'courseName', path: 'courseName', length: courseName.length,
      min: 0, max: 60, severity: 'error',
      message: !courseName.trim() ? 'Course name is required' : `Course name: ${courseName.length} > 60 characters`,
    });
    result.blocking = true;
  }
  return result;
}
