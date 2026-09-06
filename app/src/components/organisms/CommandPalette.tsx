import { useEffect, useMemo, useRef, useState } from "react";
import { Combobox, Dialog, DialogPanel } from "@headlessui/react";
import { Command, Search } from "lucide-react";
import { Input } from "../atoms/Input";
import type { CanvasCommand, CommandPaletteProps } from "../../types";

function matchesQuery(command: CanvasCommand, query: string): boolean {
  const haystack = [command.title, command.group, ...command.keywords]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase().trim());
}

export function CommandPalette({
  open,
  commands,
  onClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const availableCommands = useMemo(
    () => commands.filter((command) => command.when()),
    [commands],
  );
  const filteredCommands = useMemo(
    () => availableCommands.filter((command) => matchesQuery(command, query)),
    [availableCommands, query],
  );

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  const selectCommand = (command: CanvasCommand | null) => {
    if (!command) return;
    command.run();
    onClose();
  };

  return (
    <Dialog open={open} onClose={onClose} className="relative z-50">
      <div
        className="fixed inset-0 bg-text-primary/40 dark:bg-surface-dark/80"
        aria-hidden="true"
      />
      <div className="fixed inset-0 flex items-start justify-center p-4 pt-[12vh]">
        <DialogPanel className="w-full max-w-xl overflow-hidden rounded-sm border border-border bg-surface-raised shadow-popover dark:border-border-dark dark:bg-surface-dark-raised">
          <Combobox<CanvasCommand | null> onChange={selectCommand}>
            <div className="relative border-b border-border p-3 dark:border-border-dark">
              <Search
                className="pointer-events-none absolute left-6 top-1/2 h-4 w-4 -translate-y-1/2 text-text-muted dark:text-text-muted-dark"
                aria-hidden="true"
              />
              <Combobox.Input
                as={Input}
                ref={inputRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Search commands..."
                aria-label="Search commands"
                size="lg"
                className="pl-9"
              />
            </div>
            <Combobox.Options
              static
              className="max-h-[56vh] overflow-y-auto p-2 empty:hidden"
            >
              {filteredCommands.map((command) => (
                <Combobox.Option
                  key={command.id}
                  value={command}
                  className="group flex cursor-pointer items-center gap-3 rounded-sm px-3 py-2 text-sm text-text-primary data-[focus]:bg-surface-overlay dark:text-text-primary-dark dark:data-[focus]:bg-surface-dark-overlay"
                >
                  <Command
                    className="h-4 w-4 flex-shrink-0 text-primary dark:text-primary-light"
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1 truncate">{command.title}</span>
                  <span className="flex-shrink-0 text-xs text-text-muted dark:text-text-muted-dark">
                    {command.shortcut ?? command.group}
                  </span>
                </Combobox.Option>
              ))}
            </Combobox.Options>
            {filteredCommands.length === 0 && (
              <p className="px-5 py-8 text-center text-sm text-text-muted dark:text-text-muted-dark">
                No commands match “{query}”.
              </p>
            )}
          </Combobox>
        </DialogPanel>
      </div>
    </Dialog>
  );
}
