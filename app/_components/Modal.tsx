'use client';

import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

const openDialogs: HTMLElement[] = [];
let savedOverflow = '';

export function Modal({ title, onClose, closeOnEsc = false, closeDisabled = false, children, footer, className = 'max-w-2xl' }: {
  title: ReactNode;
  onClose: () => void;
  closeOnEsc?: boolean;
  closeDisabled?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  const disabledRef = useRef(closeDisabled);
  const [mounted, setMounted] = useState(false);
  closeRef.current = onClose;
  disabledRef.current = closeDisabled;

  useEffect(() => { setMounted(true); }, []);
  useEffect(() => {
    if (!mounted || !panelRef.current) return;
    const panel = panelRef.current;
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    if (!openDialogs.length) {
      savedOverflow = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
    }
    openDialogs.push(panel);
    const focusable = () => Array.from(panel.querySelectorAll<HTMLElement>(
      'a[href], button, input, select, textarea, [tabindex]:not([tabindex="-1"]), [contenteditable="true"]',
    )).filter((el) => !el.matches(':disabled, [hidden], [aria-hidden="true"]') && el.tabIndex >= 0 && el.getClientRects().length > 0);
    // Focus the panel first so opening a form never activates an action accidentally.
    panel.focus();
    const onFocus = (event: FocusEvent) => {
      if (openDialogs.at(-1) === panel && !panel.contains(event.target as Node)) panel.focus();
    };
    const onKey = (event: KeyboardEvent) => {
      if (openDialogs.at(-1) !== panel) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopImmediatePropagation();
        if (closeOnEsc && !disabledRef.current) closeRef.current();
      }
      if (event.key === 'Tab') {
        const items = focusable();
        const index = items.indexOf(document.activeElement as HTMLElement);
        if (!items.length) { event.preventDefault(); panel.focus(); }
        else if (event.shiftKey && index <= 0) { event.preventDefault(); items[items.length - 1].focus(); }
        else if (!event.shiftKey && (index === -1 || index === items.length - 1)) { event.preventDefault(); items[0].focus(); }
      }
    };
    document.addEventListener('keydown', onKey, true);
    document.addEventListener('focusin', onFocus);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.removeEventListener('focusin', onFocus);
      openDialogs.splice(openDialogs.indexOf(panel), 1);
      if (!openDialogs.length) document.body.style.overflow = savedOverflow;
      if (opener?.isConnected) opener.focus();
      else openDialogs.at(-1)?.focus();
    };
  }, [mounted, closeOnEsc]);

  if (!mounted) return null;
  return createPortal(
    <div className="modal-backdrop" onClick={(event) => event.stopPropagation()} onMouseDown={(event) => event.stopPropagation()}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={`modal-panel ${className}`}>
        <header className="modal-header">
          <div id={titleId} className="min-w-0 flex-1 font-semibold">{title}</div>
          <button type="button" className="btn-ghost shrink-0" aria-label="Close dialog" title={closeDisabled ? 'Wait for the current operation to finish' : 'Close dialog'} disabled={closeDisabled} onClick={onClose}>×</button>
        </header>
        <div className="modal-body">{children}</div>
        {footer && <footer className="modal-footer">{footer}</footer>}
      </div>
    </div>, document.body,
  );
}
