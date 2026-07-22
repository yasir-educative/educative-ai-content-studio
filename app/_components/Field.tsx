export function Field({
  label,
  hint,
  children,
  className = '',
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <label className={`grid gap-1.5 ${className}`}>
      <span className="label">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-[var(--text-faint)]">{hint}</span>}
    </label>
  );
}
