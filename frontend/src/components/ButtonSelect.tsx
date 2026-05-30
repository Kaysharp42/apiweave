import { useState, useRef, useEffect } from 'react';
import { ChevronDown } from 'lucide-react';

const EMPTY_OPTIONS: SelectOption[] = [];

export interface SelectOption {
  value: string;
  label: string;
}

export interface ButtonSelectProps {
  options?: SelectOption[];
  value?: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  buttonClass?: string;
}

export default function ButtonSelect({
  options = EMPTY_OPTIONS,
  value = '',
  onChange = () => {},
  placeholder = 'Select',
  buttonClass = '',
}: ButtonSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('click', onDocClick);
    return () => document.removeEventListener('click', onDocClick);
  }, []);

  const selected = options.find((o) => o.value === value);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className={buttonClass}
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className="truncate">{selected?.label ?? placeholder}</span>
        <ChevronDown className="w-4 h-4 ml-2 flex-shrink-0" />
      </button>

      {open && (
        <ul className="absolute right-0 mt-2 w-56 bg-white dark:bg-gray-800 rounded-lg shadow-lg border border-gray-200 dark:border-gray-700 z-50 overflow-auto max-h-56">
          {options.map((opt) => (
            <li key={opt.value}>
              <button
                type="button"
                onClick={() => {
                  onChange(opt.value);
                  setOpen(false);
                }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  opt.value === value
                    ? 'bg-cyan-100 dark:bg-cyan-900 text-cyan-900 dark:text-cyan-100 font-medium'
                    : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                }`}
              >
                {opt.label}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
