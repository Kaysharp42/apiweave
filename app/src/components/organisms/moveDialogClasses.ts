/**
 * The `<select>` styling both move dialogs use — the same daisyUI + design-token
 * pairing every other modal form control in the app uses (see
 * `auth/InviteUserModal.tsx`), kept in one place so the two dialogs cannot drift.
 */
export const MOVE_DIALOG_SELECT_CLASS = [
  "select select-bordered w-full cursor-pointer",
  "bg-surface-raised text-text-primary border-border",
  "dark:bg-surface-dark-raised dark:text-text-primary-dark dark:border-border-dark",
  "transition-[border-color,box-shadow,outline] duration-[var(--aw-transition-fast)] ease-in-out",
  "focus-visible:outline-2 focus-visible:outline-[var(--aw-primary)] focus-visible:outline-offset-[var(--aw-focus-ring-offset)]",
].join(" ");
