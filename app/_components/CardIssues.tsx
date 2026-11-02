import type { LimitIssue } from '@/lib/mobileCardLimits';

/**
 * The gate's verdict for one card. Errors block publishing and warnings do not,
 * so they are told apart by colour and by wording, never by colour alone.
 */
export function CardIssues({ issues }: { issues: LimitIssue[] }) {
  if (!issues.length) return null;
  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');
  return (
    <ul className="px-4 py-2.5 space-y-1 border-t border-[var(--border)] bg-[var(--panel-2)]" aria-live="polite">
      {[...errors, ...warnings].map((issue, i) => (
        <li key={`${issue.field}-${i}`} className="flex items-start gap-1.5 text-[11px] leading-snug">
          <span
            className={`mt-[3px] shrink-0 w-1.5 h-1.5 rounded-full ${issue.severity === 'error' ? 'bg-red-500' : 'bg-amber-500'}`}
            aria-hidden="true"
          />
          <span className={issue.severity === 'error' ? 'text-red-500' : 'text-amber-500'}>
            <span className="sr-only">{issue.severity === 'error' ? 'Error: ' : 'Warning: '}</span>
            {issue.message}
            {issue.severity === 'warning' && <span className="text-[var(--text-faint)]"> · does not block publishing</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

/** Deck-level banner: which cards must be fixed before the deck can publish. */
export function CardIssueSummary({ issues }: { issues: LimitIssue[] }) {
  const errors = issues.filter((issue) => issue.severity === 'error');
  const names = Array.from(new Set(errors.map((issue) => `#${issue.cardNumber ?? issue.cardId}`)));
  if (!names.length) return null;
  return (
    <div
      role="alert"
      className="flex items-start gap-2.5 rounded-xl border border-red-500/40 bg-red-500/[0.07] px-4 py-3"
    >
      <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"
        className="text-red-500 shrink-0 mt-px" aria-hidden="true">
        <circle cx="12" cy="12" r="10" /><path d="M12 8v5M12 16.5v.01" />
      </svg>
      <div className="min-w-0">
        <p className="text-xs font-semibold text-red-500">
          {names.length === 1 ? `Card ${names[0]} has errors` : `${names.length} cards have errors`}
        </p>
        <p className="text-[11px] text-[var(--text-dim)] mt-0.5">
          {names.length > 1 && <span className="font-mono">{names.join(', ')} · </span>}
          Fix the fields on the card, or use Rewrite, before publishing.
        </p>
      </div>
    </div>
  );
}
