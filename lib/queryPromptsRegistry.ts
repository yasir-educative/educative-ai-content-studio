import { registerPrompt } from './promptStore';
import { queriesTriagePrompt, psbDraftPrompt, fsbDraftPrompt, queriesPolishPrompt, queriesChangesPrompt } from './queryPrompts';

export const registeredQueriesTriagePrompt = registerPrompt('queries-triage',       queriesTriagePrompt, 'queries');
export const registeredPsbDraftPrompt      = registerPrompt('queries-draft-psb',    psbDraftPrompt,      'queries');
export const registeredFsbDraftPrompt      = registerPrompt('queries-draft-fenzo',  fsbDraftPrompt,      'queries');
export const registeredQueriesPolishPrompt = registerPrompt('queries-polish',       queriesPolishPrompt, 'queries');
export const registeredQueriesChangesPrompt = registerPrompt('queries-changes',      queriesChangesPrompt, 'queries');
