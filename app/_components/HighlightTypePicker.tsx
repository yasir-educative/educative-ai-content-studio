'use client';

import { HIGHLIGHT_CARD_TYPES, isHighlightCardType } from '@/lib/mobileCardTypes';
import type { HighlightCardType } from '@/lib/mobileCardTypes';

/**
 * Picks the highlight variant. There are exactly three and one is required
 * before publishing, so they are shown as a segmented control rather than
 * hidden behind a dropdown; each option's meaning is its tooltip.
 */
export function HighlightTypePicker({ value, onChange, readOnly }: {
  value?: string;
  onChange?: (value: HighlightCardType) => void;
  readOnly?: boolean;
}) {
  const current = isHighlightCardType(value) ? value : undefined;

  if (readOnly || !onChange) {
    return current ? (
      <span className="hl-option" aria-pressed="true">
        {HIGHLIGHT_CARD_TYPES.find((t) => t.id === current)!.label}
      </span>
    ) : (
      <span className="hl-unset-note">Highlight type not selected</span>
    );
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="hl-picker" data-unset={!current} role="group" aria-label="Highlight type">
        {HIGHLIGHT_CARD_TYPES.map((type) => (
          <button
            key={type.id}
            type="button"
            className="hl-option"
            aria-pressed={current === type.id}
            title={type.meaning}
            onClick={() => onChange(type.id)}
          >
            {type.label}
          </button>
        ))}
      </div>
      {!current && <span className="hl-unset-note">Pick one — publishing is blocked until you do</span>}
    </div>
  );
}
