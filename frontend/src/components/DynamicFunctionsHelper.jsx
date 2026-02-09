import React, { useState } from 'react';
import { Copy, Info, ChevronDown, ChevronUp, Sparkles, CheckCircle, Type, Hash, Calendar, Clock, Code, Link } from 'lucide-react';

const DynamicFunctionsHelper = () => {
  const [expandedCategory, setExpandedCategory] = useState('string');
  const [copiedFunc, setCopiedFunc] = useState(null);

  const functions = {
    string: [
      {
        name: 'randomString',
        syntax: 'randomString(length)',
        example: 'randomString(10)',
        result: 'aBcD1eFg2H',
        description: 'Alphanumeric random string',
        default: 'length = 10'
      },
      {
        name: 'randomEmail',
        syntax: 'randomEmail()',
        example: 'randomEmail()',
        result: 'aBcD@example.com',
        description: 'Random email address',
        default: 'N/A'
      },
      {
        name: 'randomAlpha',
        syntax: 'randomAlpha(length)',
        example: 'randomAlpha(8)',
        result: 'aBcDeFgH',
        description: 'Letters only, no numbers',
        default: 'length = 10'
      },
      {
        name: 'randomNumeric',
        syntax: 'randomNumeric(length)',
        example: 'randomNumeric(6)',
        result: '123456',
        description: 'Digits only',
        default: 'length = 10'
      },
      {
        name: 'randomHex',
        syntax: 'randomHex(length)',
        example: 'randomHex(8)',
        result: 'a1b2c3d4',
        description: 'Hexadecimal string',
        default: 'length = 16'
      }
    ],
    number: [
      {
        name: 'randomNumber',
        syntax: 'randomNumber(size)',
        example: 'randomNumber(6)',
        result: '123456',
        description: 'N-digit random number',
        default: 'size = 6'
      },
      {
        name: 'randomChoice',
        syntax: 'randomChoice(options)',
        example: 'randomChoice(active,inactive,pending)',
        result: 'inactive',
        description: 'Pick one from comma-separated list',
        default: 'Required'
      }
    ],
    date: [
      {
        name: 'date',
        syntax: 'date(format)',
        example: 'date()',
        result: '2025-10-30',
        description: 'Current date with format',
        default: 'format = %Y-%m-%d'
      },
      {
        name: 'futureDate',
        syntax: 'futureDate(days, format)',
        example: 'futureDate(7)',
        result: '2025-11-06',
        description: 'Date N days in the future',
        default: 'days = 1, format = %Y-%m-%d'
      },
      {
        name: 'pastDate',
        syntax: 'pastDate(days, format)',
        example: 'pastDate(30)',
        result: '2025-09-30',
        description: 'Date N days in the past',
        default: 'days = 1, format = %Y-%m-%d'
      }
    ],
    time: [
      {
        name: 'timestamp',
        syntax: 'timestamp()',
        example: 'timestamp()',
        result: '1730290800',
        description: 'Unix timestamp (seconds since epoch)',
        default: 'N/A'
      },
      {
        name: 'iso_timestamp',
        syntax: 'iso_timestamp()',
        example: 'iso_timestamp()',
        result: '2025-10-30T14:30:45.123456',
        description: 'ISO 8601 format timestamp',
        default: 'N/A'
      }
    ],
    identifier: [
      {
        name: 'uuid',
        syntax: 'uuid()',
        example: 'uuid()',
        result: '550e8400-e29b-41d4-a716-446655440000',
        description: 'UUID v4 (universally unique identifier)',
        default: 'N/A'
      }
    ]
  };

  const categoryIcons = {
    string: Type,
    number: Hash,
    date: Calendar,
    time: Clock,
    identifier: Code
  };

  const categoryTitles = {
    string: 'String Functions',
    number: 'Number Functions',
    date: 'Date Functions',
    time: 'Time Functions',
    identifier: 'Identifier Functions'
  };

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(`{{${text}}}`);
    setCopiedFunc(text);
    setTimeout(() => setCopiedFunc(null), 2000);
  };

  return (
    <div className="w-full bg-white dark:bg-gray-800 overflow-y-auto h-full flex flex-col">
      {/* Header */}
      <div className="sticky top-0 bg-gradient-to-r from-purple-50 to-pink-50 dark:from-purple-900/30 dark:to-pink-900/30 border-b dark:border-gray-700 p-3 z-10">
        <div className="flex items-center gap-2">
          <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
          <h2 className="font-bold text-sm text-gray-800 dark:text-gray-200">Dynamic Functions</h2>
        </div>
        <p className="text-[10px] text-gray-600 dark:text-gray-400 mt-1">
          Generate random data, dates, IDs on every run
        </p>
      </div>

      {/* Functions List */}
      <div className="p-3 space-y-2 flex-1 overflow-y-auto">
        {Object.entries(functions).map(([category, funcs]) => (
          <div key={category} className="border dark:border-gray-700 rounded-lg overflow-hidden">
            {/* Category Header */}
            <button
              onClick={() => setExpandedCategory(expandedCategory === category ? null : category)}
              className="w-full flex items-center justify-between p-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors"
            >
              <div className="flex items-center gap-2">
                <span className="text-lg">{React.createElement(categoryIcons[category], { className: 'w-5 h-5' })}</span>
                <span className="text-xs font-semibold text-gray-800 dark:text-gray-200">
                  {categoryTitles[category]}
                </span>
                <span className="text-[10px] bg-gray-300 dark:bg-gray-600 text-gray-700 dark:text-gray-300 px-2 py-0.5 rounded-full">
                  {funcs.length}
                </span>
              </div>
              {expandedCategory === category ? (
                <ChevronUp className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-gray-600 dark:text-gray-400" />
              )}
            </button>

            {/* Functions List */}
            {expandedCategory === category && (
              <div className="divide-y dark:divide-gray-700">
                {funcs.map((func, idx) => (
                  <div key={idx} className="p-2 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-750">
                    {/* Function Name & Copy Button */}
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <div className="flex-1 min-w-0">
                        <code className="text-xs font-mono font-bold text-blue-700 dark:text-blue-300 break-all">
                          {func.syntax}
                        </code>
                      </div>
                      <button
                        onClick={() => copyToClipboard(func.example)}
                        className={`flex-shrink-0 px-2 py-1 rounded text-xs font-semibold transition-colors flex items-center gap-1 ${
                          copiedFunc === func.example
                            ? 'bg-green-500 dark:bg-green-600 text-white'
                            : 'bg-blue-500 dark:bg-blue-600 hover:bg-blue-600 dark:hover:bg-blue-700 text-white'
                        }`}
                        title="Copy to clipboard"
                      >
                        <Copy className="w-3 h-3" />
                        {copiedFunc === func.example ? 'Copied!' : 'Copy'}
                      </button>
                    </div>

                    {/* Description */}
                    <p className="text-[10px] text-gray-600 dark:text-gray-400 mb-1.5">
                      {func.description}
                    </p>

                    {/* Example */}
                    <div className="bg-gray-100 dark:bg-gray-700 p-1.5 rounded mb-1.5 text-[10px] space-y-0.5">
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">Example: </span>
                        <code className="text-gray-800 dark:text-gray-200 font-mono">
                          {`{{${func.example}}}`}
                        </code>
                      </div>
                      <div>
                        <span className="text-gray-600 dark:text-gray-400">Result: </span>
                        <code className="text-green-700 dark:text-green-300 font-mono">
                          {func.result}
                        </code>
                      </div>
                    </div>

                    {/* Default Value */}
                    {func.default !== 'N/A' && (
                      <div className="text-[9px] text-gray-500 dark:text-gray-500 flex items-start gap-1">
                        <Info className="w-3 h-3 flex-shrink-0 mt-0.5" />
                        <span>Default: {func.default}</span>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Usage Tips */}
      <div className="border-t dark:border-gray-700 p-3 text-[10px] text-gray-600 dark:text-gray-400 bg-gray-50 dark:bg-gray-900/50 space-y-1.5">
        <div className="font-semibold text-gray-700 dark:text-gray-300 flex items-center gap-1">
          <Sparkles className="w-3 h-3" />
          Quick Tips
        </div>
        
        <ul className="space-y-1 pl-4">
          <li className="flex items-start gap-1">
            <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            Use in any field: URL, Headers, Body, Assertions
          </li>
          <li className="flex items-start gap-1">
            <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            Fresh value generated per workflow run
          </li>
          <li className="flex items-start gap-1">
            <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            Combine multiple functions: <code className="bg-gray-200 dark:bg-gray-700 px-1 rounded ml-1">{`user_{{randomNumber(4)}}@test.com`}</code>
          </li>
          <li className="flex items-start gap-1">
            <CheckCircle className="w-3 h-3 flex-shrink-0 mt-0.5" />
            Works in Workflow Variables too
          </li>
        </ul>

        <div className="pt-1.5 border-t border-gray-300 dark:border-gray-600 flex items-center gap-1">
          <Calendar className="w-3 h-3" />
          <span className="font-semibold text-gray-700 dark:text-gray-300">Date Format Codes</span>
        </div>
        <ul className="space-y-0.5 pl-4 text-[9px]">
          <li>%Y = Year (2025) | %m = Month (10) | %d = Day (30)</li>
          <li>%H = Hour (14) | %M = Minute (30) | %S = Second (45)</li>
          <li>Example: <code className="bg-gray-200 dark:bg-gray-700 px-1">{`date("%d/%m/%Y")`}</code> → 30/10/2025</li>
        </ul>

        <div className="pt-1.5 border-t border-gray-300 dark:border-gray-600 flex items-center gap-1">
          <Link className="w-3 h-3" />
          <span className="font-semibold text-gray-700 dark:text-gray-300">In Assertions</span>
        </div>
        <p className="text-[9px] pl-4">
          Compare with dynamic values: <code className="bg-gray-200 dark:bg-gray-700 px-1">{`Expected: {{futureDate(1)}}`}</code>
        </p>
      </div>
    </div>
  );
};

export default DynamicFunctionsHelper;
