import { useEffect, useMemo, useRef, useState } from 'react';

const languageNames =
  typeof Intl !== 'undefined' && 'DisplayNames' in Intl
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;

export function formatLanguage(code: string): string {
  return languageNames?.of(code) ?? code.toUpperCase();
}

type LanguageMultiSelectProps = {
  options: string[];
  selected: string[];
  onToggle: (language: string) => void;
  onClear: () => void;
  label?: string;
  emptyLabel?: string;
  className?: string;
  columns?: 2 | 3 | 4;
  maxHeightClassName?: string;
  helperText?: string;
};

export function LanguageMultiSelect({
  options,
  selected,
  onToggle,
  onClear,
  label = 'Language',
  emptyLabel = 'Any language',
  className = '',
  columns = 2,
  maxHeightClassName = 'max-h-32',
  helperText,
}: LanguageMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);
  const normalizedSelected = new Set(selected);
  const gridClassName = columns === 4 ? 'grid-cols-2 sm:grid-cols-4' : columns === 3 ? 'grid-cols-2 sm:grid-cols-3' : 'grid-cols-2';
  const triggerLabel = useMemo(() => {
    if (selected.length === 0) return emptyLabel;
    if (selected.length <= 2) {
      return selected.map((language) => formatLanguage(language)).join(', ');
    }
    return `${selected.length} languages selected`;
  }, [emptyLabel, selected]);

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false);
      }
    };

    window.addEventListener('mousedown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('mousedown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className={`flex flex-col gap-2 ${className}`}>
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-[2px] text-zinc-600">{label}</span>
        {selected.length > 0 && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] uppercase tracking-[2px] text-zinc-500 transition hover:text-zinc-200"
          >
            clear
          </button>
        )}
      </div>
      <div className="relative">
        <button
          type="button"
          onClick={() => setOpen((value) => !value)}
          className="flex w-full items-center justify-between rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 text-left text-[12px] text-zinc-100 outline-none transition hover:border-white/20 focus:border-white/30"
        >
          <span className={selected.length > 0 ? 'truncate text-zinc-100' : 'truncate text-zinc-600'}>{triggerLabel}</span>
          <span className={`ml-3 shrink-0 text-[10px] text-zinc-500 transition ${open ? 'rotate-180' : ''}`}>▾</span>
        </button>
        {open && (
          <div className="absolute left-0 right-0 top-[calc(100%+8px)] z-40 rounded-2xl border border-white/10 bg-black/90 p-3 shadow-[0_12px_40px_rgba(0,0,0,0.45)] backdrop-blur-md">
            {options.length > 0 ? (
              <div className={`${maxHeightClassName} overflow-y-auto`}>
                <div className={`grid gap-2 ${gridClassName}`}>
                  {options.map((language) => {
                    const active = normalizedSelected.has(language);
                    return (
                      <button
                        key={language}
                        type="button"
                        onClick={() => onToggle(language)}
                        className={`rounded-lg border px-3 py-1.5 text-left text-[11px] transition ${
                          active
                            ? 'border-white/35 bg-white/12 text-zinc-100'
                            : 'border-white/8 bg-transparent text-zinc-500 hover:border-white/20 hover:text-zinc-200'
                        }`}
                      >
                        {formatLanguage(language)}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="px-1 py-2 text-[11px] text-zinc-600">No language data available yet.</div>
            )}
          </div>
        )}
      </div>
      {helperText && <div className="text-[11px] text-zinc-600">{helperText}</div>}
    </div>
  );
}
