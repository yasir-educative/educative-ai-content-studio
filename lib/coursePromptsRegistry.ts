// Registry wiring for course prompts — same pattern as promptsRegistry.ts.
import { registerPrompt } from './promptStore';
import * as P from './coursePrompts';

export const courseOutlineGeneratorPrompt = registerPrompt(
  'course-outline-generator', P.courseOutlineGeneratorPrompt, 'course',
);
export const courseContentCreatorPrompt = registerPrompt(
  'course-content-creator', P.courseContentCreatorPrompt, 'course',
);
export const courseSummaryElementsPrompt = registerPrompt(
  'course-summary-elements', P.courseSummaryElementsPrompt, 'course',
);
export const coursePrReviewerPrompt = registerPrompt(
  'course-pr-reviewer', P.coursePrReviewerPrompt, 'course',
);
export const courseCodeGeneratorPrompt = registerPrompt(
  'course-code-generator', P.courseCodeGeneratorPrompt, 'course',
);
export const courseTableGeneratorPrompt = registerPrompt(
  'course-table-generator', P.courseTableGeneratorPrompt, 'course',
);
export const courseRunJsElaboratePrompt = registerPrompt(
  'course-runjs-elaborate', P.courseRunJsElaboratePrompt, 'course',
);
export const courseRunJsCreatorPrompt = registerPrompt(
  'course-runjs-creator', P.courseRunJsCreatorPrompt, 'course',
);
export const courseImagePrompt = registerPrompt(
  'course-image', P.courseImagePrompt, 'course',
);
