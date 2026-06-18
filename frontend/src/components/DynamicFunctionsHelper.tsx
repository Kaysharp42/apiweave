import { useState, type ElementType } from 'react';
import { Copy, Info, Search, Sparkles, CheckCircle, Type, Hash, Calendar, Clock, Code, ChevronDown } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from './atoms/Button';
import { EmptyState } from './molecules/EmptyState';

interface DynamicFunction {
  name: string;
  syntax: string;
  example: string;
  result: string;
  description: string;
  default: string;
}

type FunctionCategory = 'string' | 'number' | 'date' | 'time' | 'identifier';

const functions: Record<FunctionCategory, DynamicFunction[]> = {
  string: [
    { name: 'randomString', syntax: 'randomString(length)', example: 'randomString(10)', result: 'aBcD1eFg2H', description: 'Alphanumeric random string', default: 'length = 10' },
    { name: 'randomEmail', syntax: 'randomEmail()', example: 'randomEmail()', result: 'aBcD@example.com', description: 'Random email address', default: 'N/A' },
    { name: 'randomAlpha', syntax: 'randomAlpha(length)', example: 'randomAlpha(8)', result: 'aBcDeFgH', description: 'Letters only, no numbers', default: 'length = 10' },
    { name: 'randomNumeric', syntax: 'randomNumeric(length)', example: 'randomNumeric(6)', result: '123456', description: 'Digits only', default: 'length = 10' },
    { name: 'randomHex', syntax: 'randomHex(length)', example: 'randomHex(8)', result: 'a1b2c3d4', description: 'Hexadecimal string', default: 'length = 16' },
  ],
  number: [
    { name: 'randomNumber', syntax: 'randomNumber(size)', example: 'randomNumber(6)', result: '123456', description: 'N-digit random number', default: 'size = 6' },
    { name: 'randomChoice', syntax: 'randomChoice(options)', example: 'randomChoice(active,inactive,pending)', result: 'inactive', description: 'Pick one from comma-separated list', default: 'Required' },
  ],
  date: [
    { name: 'date', syntax: 'date(format)', example: 'date()', result: '2025-10-30', description: 'Current date with format', default: 'format = %Y-%m-%d' },
    { name: 'futureDate', syntax: 'futureDate(days, format)', example: 'futureDate(7)', result: '2025-11-06', description: 'Date N days in the future', default: 'days = 1, format = %Y-%m-%d' },
    { name: 'pastDate', syntax: 'pastDate(days, format)', example: 'pastDate(30)', result: '2025-09-30', description: 'Date N days in the past', default: 'days = 1, format = %Y-%m-%d' },
  ],
  time: [
    { name: 'timestamp', syntax: 'timestamp()', example: 'timestamp()', result: '1730290800', description: 'Unix timestamp (seconds since epoch)', default: 'N/A' },
    { name: 'iso_timestamp', syntax: 'iso_timestamp()', example: 'iso_timestamp()', result: '2025-10-30T14:30:45.123456', description: 'ISO 8601 format timestamp', default: 'N/A' },
  ],
  identifier: [
    { name: 'uuid', syntax: 'uuid()', example: 'uuid()', result: '550e8400-e29b-41d4-a716-446655440000', description: 'UUID v4 (universally unique identifier)', default: 'N/A' },
  ],
};

const categoryIcons: Record<FunctionCategory, ElementType> = {
  string: Type, number: Hash, date: Calendar, time: Clock, identifier: Code,
};

const categoryTitles: Record<FunctionCategory, string> = {
  string: 'String Functions', number: 'Number Functions', date: 'Date Functions', time: 'Time Functions', identifier: 'Identifier Functions',
};

export default function DynamicFunctionsHelper() {
  const [expandedCategory, setExpandedCategory] = useState<FunctionCategory | null>('string');
  const [copiedFunc, setCopiedFunc] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  const copyToClipboard = (text: string) => {
    navigator.clipboard.writeText(`{{${text}}}`);
    setCopiedFunc(text);
    toast.success('Copied to clipboard');
    setTimeout(() => setCopiedFunc(null), 2000);
  };

  const normalizedQuery = searchTerm.trim().toLowerCase();
  const filteredFunctions = Object.entries(functions).reduce<Partial<Record<FunctionCategory, DynamicFunction[]>>>((acc, [category, funcs]) => {
    const nextFuncs = funcs.filter((func) => {
      if (!normalizedQuery) return true;
      return (
        func.name.toLowerCase().includes(normalizedQuery)
        || func.syntax.toLowerCase().includes(normalizedQuery)
        || func.description.toLowerCase().includes(normalizedQuery)
      );
    });

    if (nextFuncs.length > 0) {
      acc[category as FunctionCategory] = nextFuncs;
    }

    return acc;
  }, {});

  const visibleCategories = Object.entries(filteredFunctions) as [FunctionCategory, DynamicFunction[]][];

  return (
    <div className="w-full h-full flex flex-col bg-surface-raised dark:bg-surface-dark-raised overflow-hidden">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-surface-overlay dark:bg-surface-dark-overlay border-b border-border dark:border-border-dark p-3">
        <div className="flex items-center gap-2 min-w-0">
          <Sparkles className="w-5 h-5 flex-shrink-0 text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)]" />
          <h2 className="font-bold text-sm text-text-primary dark:text-text-primary-dark min-w-0 truncate">Dynamic Functions</h2>
        </div>
        <p className="text-[10px] text-text-muted dark:text-text-muted-dark mt-1">
          Generate random data, dates, IDs on every run
        </p>
        <div className="relative mt-2">
          <Search className="w-3.5 h-3.5 absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted dark:text-text-muted-dark pointer-events-none" />
          <input
            type="text"
            value={searchTerm}
            onChange={(event) => setSearchTerm(event.target.value)}
            placeholder="Search functions"
            className="w-full pl-8 pr-2 py-1.5 border border-border dark:border-border-dark bg-surface dark:bg-surface-dark text-text-primary dark:text-text-primary-dark rounded text-xs focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)] transition-[border-color,box-shadow] duration-[var(--aw-transition-fast)] ease-in-out"
            aria-label="Search functions"
          />
        </div>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 min-w-0 overflow-y-auto overflow-x-hidden p-3 space-y-2">
        {visibleCategories.map(([category, funcs]) => {
          const Icon = categoryIcons[category];
          const isOpen = expandedCategory === category;

          return (
            <div
              key={category}
              className="border border-border dark:border-border-dark rounded bg-surface dark:bg-surface-dark overflow-hidden"
            >
              <button
                type="button"
                onClick={() => setExpandedCategory(isOpen ? null : category)}
                className="w-full flex items-center gap-2 p-2 cursor-pointer hover:bg-surface-overlay dark:hover:bg-surface-dark-overlay transition-colors motion-reduce:transition-none focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]"
                aria-expanded={isOpen}
                aria-label={`Toggle ${categoryTitles[category]}`}
              >
                <Icon className="w-4 h-4 flex-shrink-0 text-text-secondary dark:text-text-secondary-dark" aria-hidden="true" />
                <span className="text-xs font-semibold text-text-primary dark:text-text-primary-dark min-w-0 truncate flex-1 text-left">
                  {categoryTitles[category]}
                </span>
                <span className="inline-flex items-center justify-center text-[10px] px-1.5 py-0.5 rounded bg-surface-overlay dark:bg-surface-dark-overlay text-text-secondary dark:text-text-secondary-dark border border-border dark:border-border-dark flex-shrink-0">
                  {funcs.length}
                </span>
                <ChevronDown
                  className={`w-3.5 h-3.5 flex-shrink-0 text-text-muted dark:text-text-muted-dark transition-transform duration-200 motion-reduce:transition-none ${isOpen ? 'rotate-180' : ''}`}
                  aria-hidden="true"
                />
              </button>

              {isOpen && (
                <div className="divide-y divide-border dark:divide-border-dark border-t border-border dark:border-border-dark">
                  {funcs.map((func) => (
                    <div key={func.syntax} className="p-2 hover:bg-surface-overlay/50 dark:hover:bg-surface-dark-overlay/50 transition-colors motion-reduce:transition-none">
                      <div className="flex items-start justify-between gap-2 mb-1 min-w-0">
                        <code className="text-xs font-mono font-bold text-[var(--aw-primary)] dark:text-[var(--aw-primary-light)] break-all min-w-0">
                          {func.syntax}
                        </code>
                        <Button
                          type="button"
                          onClick={() => copyToClipboard(func.example)}
                          size="xs"
                          variant={copiedFunc === func.example ? 'primary' : 'secondary'}
                          intent={copiedFunc === func.example ? 'success' : 'default'}
                          className="flex-shrink-0"
                          icon={copiedFunc === func.example ? <CheckCircle className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
                        >
                          {copiedFunc === func.example ? 'Copied' : 'Copy'}
                        </Button>
                      </div>

                      <p className="text-[10px] text-text-muted dark:text-text-muted-dark mb-1.5">{func.description}</p>

                      <div className="bg-surface-overlay dark:bg-surface-dark-overlay p-1.5 rounded mb-1.5 text-[10px] space-y-0.5 border border-border/50 dark:border-border-dark/50 min-w-0">
                        <div className="min-w-0">
                          <span className="text-text-muted">Example: </span>
                          <code className="text-text-primary dark:text-text-primary-dark font-mono break-all">
                            {`{{${func.example}}}`}
                          </code>
                        </div>
                        <div className="min-w-0">
                          <span className="text-text-muted">Result: </span>
                          <code className="text-status-success dark:text-[var(--aw-status-success)] font-mono break-all">{func.result}</code>
                        </div>
                      </div>

                      {func.default !== 'N/A' && (
                        <div className="text-[9px] text-text-muted dark:text-text-muted-dark flex items-start gap-1 min-w-0">
                          <Info className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
                          <span className="break-all">Default: {func.default}</span>
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {visibleCategories.length === 0 && (
          <EmptyState
            title="No matching functions"
            description="Try a different search term"
            className="py-6"
          />
        )}
      </div>

      {/* Tips footer */}
      <div className="border-t border-border dark:border-border-dark p-3 text-[10px] text-text-muted dark:text-text-muted-dark bg-surface-overlay dark:bg-surface-dark-overlay space-y-1.5 overflow-x-hidden flex-shrink-0">
        <div className="font-semibold text-text-secondary dark:text-text-secondary-dark flex items-center gap-1">
          <Sparkles className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
          Quick Tips
        </div>

        <ul className="space-y-1 pl-4">
          <li className="flex items-start gap-1">
            <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span className="break-words">Use in any field: URL, Headers, Body, Assertions</span>
          </li>
          <li className="flex items-start gap-1">
            <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span className="break-words">Fresh value generated per workflow run</span>
          </li>
          <li className="flex items-start gap-1">
            <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span className="break-words">
              Combine: <code className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark px-1 rounded break-all">{`user_{{randomNumber(4)}}@test.com`}</code>
            </span>
          </li>
          <li className="flex items-start gap-1">
            <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" aria-hidden="true" />
            <span className="break-words">Works in Workflow Variables too</span>
          </li>
        </ul>

        <div className="pt-1.5 border-t border-border dark:border-border-dark flex items-center gap-1">
          <Calendar className="w-3 h-3 flex-shrink-0" aria-hidden="true" />
          <span className="font-semibold text-text-secondary dark:text-text-secondary-dark">Date Format Codes</span>
        </div>
        <ul className="space-y-0.5 pl-4 text-[9px]">
          <li className="break-words">%Y = Year (2025) | %m = Month (10) | %d = Day (30)</li>
          <li className="break-words">%H = Hour (14) | %M = Minute (30) | %S = Second (45)</li>
          <li className="break-words">
            Example: <code className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark px-1 break-all">{`date("%d/%m/%Y")`}</code> → 30/10/2025
          </li>
        </ul>

        <div className="pt-1.5 border-t border-border dark:border-border-dark flex items-center gap-1">
          <span className="font-semibold text-text-secondary dark:text-text-secondary-dark">In Assertions</span>
        </div>
        <p className="text-[9px] pl-4 break-words">
          Compare with dynamic values: <code className="bg-surface dark:bg-surface-dark border border-border dark:border-border-dark px-1 break-all">{`Expected: {{futureDate(1)}}`}</code>
        </p>
      </div>
    </div>
  );
}
