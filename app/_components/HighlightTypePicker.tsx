'use client';

import {
  HIGHLIGHT_CARD_TYPES, SCENARIO_CARD_TYPES,
  isHighlightCardType, isScenarioCardType,
} from '@/lib/mobileCardTypes';
import type { HighlightCardType, ScenarioCardType } from '@/lib/mobileCardTypes';

/**
 * Picks a card's variant. Highlights and scenarios each have exactly three and
 * one is required before publishing, so they are shown as a segmented control
 * rather than hidden behind a dropdown; each option's meaning is its tooltip.
 */
function VariantPicker<T extends string>({ options, value, onChange, readOnly, unsetLabel, groupLabel }: {
  options: ReadonlyArray<{ id: T; label: string; meaning: string }>;
  value?: string;
  onChange?: (value: T) => void;
  readOnly?: boolean;
  unsetLabel: string;
  groupLabel: string;
}) {
  const current = options.find((type) => type.id === value);

  if (readOnly || !onChange) {
    return current
      ? <span className="hl-option" aria-pressed="true">{current.label}</span>
      : <span className="hl-unset-note">{unsetLabel}</span>;
  }

  return (
    <div className="flex flex-col items-center gap-1.5">
      <div className="hl-picker" data-unset={!current} role="group" aria-label={groupLabel}>
        {options.map((type) => (
          <button
            key={type.id}
            type="button"
            className="hl-option"
            aria-pressed={current?.id === type.id}
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

export function HighlightTypePicker({ value, onChange, readOnly }: {
  value?: string;
  onChange?: (value: HighlightCardType) => void;
  readOnly?: boolean;
}) {
  return (
    <VariantPicker
      options={HIGHLIGHT_CARD_TYPES}
      value={isHighlightCardType(value) ? value : undefined}
      onChange={onChange}
      readOnly={readOnly}
      unsetLabel="Highlight type not selected"
      groupLabel="Highlight type"
    />
  );
}

/**
 * The scenario variant also decides the three tab headings, so changing it
 * rewrites them — the caller runs `applyScenarioHeadings` on the result.
 */
export function ScenarioTypePicker({ value, onChange, readOnly }: {
  value?: string;
  onChange?: (value: ScenarioCardType) => void;
  readOnly?: boolean;
}) {
  return (
    <VariantPicker
      options={SCENARIO_CARD_TYPES}
      value={isScenarioCardType(value) ? value : undefined}
      onChange={onChange}
      readOnly={readOnly}
      unsetLabel="Scenario type not selected"
      groupLabel="Scenario type"
    />
  );
}
