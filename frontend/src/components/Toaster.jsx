import React, { useEffect, useState } from 'react';

// Simple event-based toaster so any module can call `toast(message, opts)`
const emitter = new EventTarget();

export function toast(message, { type = 'info', duration = 4000 } = {}) {
  emitter.dispatchEvent(new CustomEvent('toast', { detail: { message, type, duration } }));
}

export default function Toaster() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const handler = (e) => {
      const id = Date.now() + Math.random();
      const t = { id, ...e.detail };
      setToasts((s) => [t, ...s]);
      // Auto-remove
      setTimeout(() => {
        setToasts((s) => s.filter((x) => x.id !== id));
      }, e.detail.duration || 4000);
    };

    emitter.addEventListener('toast', handler);
    return () => emitter.removeEventListener('toast', handler);
  }, []);

  return (
    <div className="pointer-events-none fixed top-4 right-4 z-50 flex flex-col items-end gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto max-w-sm w-full px-3 py-2 rounded shadow-lg text-sm transition-opacity duration-200 break-words ${
            t.type === 'error' ? 'bg-red-600 text-white' : t.type === 'success' ? 'bg-green-600 text-white' : 'bg-gray-800 text-white'
          }`}
        >
          <div className="text-xs opacity-90">{t.type.toUpperCase()}</div>
          <div className="mt-1 text-sm font-mono">{t.message}</div>
        </div>
      ))}
    </div>
  );
}
