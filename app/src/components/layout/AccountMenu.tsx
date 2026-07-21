import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { ShieldCheck } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { useCloudSync } from "../../hooks/useCloudSync";
import { Button } from "../atoms/Button";
import { CloudAccountSection } from "./CloudAccountSection";
import {
  getAccountInitials,
  getConnectionBadge,
  getRoleSummary,
  resolveAccountIdentity,
} from "./accountMenuUtils";

export function AccountMenu() {
  const { user, isAuthenticated } = useAuth();
  // Second useCloudSync instance: it only reads status for the header identity.
  // Both instances share the same push-based refresh (onCloudStatusChanged), so
  // the only extra cost is one status fetch on mount.
  const cloud = useCloudSync();
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<
    Array<HTMLAnchorElement | HTMLButtonElement | null>
  >([]);

  // Reset the failed flag when the effective avatar source changes (cloud
  // picture takes precedence over the local one — see resolveAccountIdentity).
  const cloudAvatarUrl =
    cloud.status?.linkState === "linked"
      ? cloud.status.account?.avatarUrl
      : undefined;
  useEffect(() => {
    setAvatarFailed(false);
  }, [cloudAvatarUrl, user?.avatar_url]);

  useEffect(() => {
    if (!open) return undefined;

    const handleOutsideClick = (event: MouseEvent | TouchEvent) => {
      if (
        wrapperRef.current &&
        !wrapperRef.current.contains(event.target as Node)
      ) {
        setOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };

    document.addEventListener("mousedown", handleOutsideClick);
    document.addEventListener(
      "touchstart",
      handleOutsideClick as EventListener,
      { passive: true },
    );
    document.addEventListener("keydown", handleEscape);

    return () => {
      document.removeEventListener("mousedown", handleOutsideClick);
      document.removeEventListener(
        "touchstart",
        handleOutsideClick as EventListener,
      );
      document.removeEventListener("keydown", handleEscape);
    };
  }, [open]);

  if (!isAuthenticated || !user) {
    return null;
  }

  // Identity reflects the linked cloud account once available, falling back to
  // the local profile — so the name and email update after linking.
  const { name, email, avatarUrl } = resolveAccountIdentity(user, cloud.status);
  const initials = getAccountInitials(user, name);
  const roleSummary = getRoleSummary(user);
  const connection = getConnectionBadge(cloud.status, cloud.unavailable);
  const avatarVisible = Boolean(avatarUrl) && !avatarFailed;

  const closeMenu = (focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) {
      triggerRef.current?.focus();
    }
  };

  const focusFirstMenuItem = () => {
    const first = menuItemRefs.current.find((item) => item != null);
    first?.focus();
  };

  const handleTriggerKeyDown = (
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => {
    if (
      event.key === "Enter" ||
      event.key === " " ||
      event.key === "ArrowDown"
    ) {
      event.preventDefault();
      setOpen(true);
      requestAnimationFrame(focusFirstMenuItem);
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    }
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        className="h-9 w-9 overflow-hidden !rounded-full border border-border bg-surface-raised p-0 hover:bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-raised dark:hover:bg-surface-dark-overlay"
        aria-label={`Account menu for ${name}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={name}
      >
        {avatarVisible ? (
          <img
            src={user.avatar_url ?? undefined}
            alt={name}
            className="h-full w-full object-cover"
            onError={() => {
              setAvatarFailed(true);
            }}
          />
        ) : null}
        {!avatarVisible && (
          <span className="flex h-full w-full items-center justify-center select-none bg-primary/10 text-xs font-semibold text-primary dark:bg-primary-light/10 dark:text-primary-light">
            {initials}
          </span>
        )}
      </Button>

      {open && (
        <div
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-border bg-surface-raised shadow-node dark:border-border-dark dark:bg-surface-dark-raised"
          role="menu"
          aria-label="Account actions"
        >
          <div className="flex items-start gap-3 px-4 pb-3 pt-4">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-primary/20 bg-primary/10 dark:border-primary-light/20 dark:bg-primary-light/10">
              {avatarVisible ? (
                <img
                  src={avatarUrl ?? undefined}
                  alt={name}
                  className="h-full w-full object-cover"
                  onError={() => {
                    setAvatarFailed(true);
                  }}
                />
              ) : (
                <span className="text-sm font-semibold text-primary dark:text-primary-light">
                  {initials}
                </span>
              )}
            </div>

            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold text-text-primary dark:text-text-primary-dark">
                {name}
              </div>
              <div className="mt-0.5 truncate font-mono text-[11px] text-text-muted dark:text-text-muted-dark">
                {email}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className="inline-flex items-center gap-1 rounded-full bg-surface-overlay px-2 py-0.5 text-[11px] font-medium text-text-secondary dark:bg-surface-dark-overlay dark:text-text-secondary-dark">
                  <ShieldCheck className="h-3 w-3 text-status-success dark:text-status-success-dark" />
                  {roleSummary}
                </span>
                {connection && (
                  <span
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium ${connection.className}`}
                  >
                    <span
                      className={`h-1.5 w-1.5 rounded-full ${connection.dotClassName}`}
                    />
                    {connection.label}
                  </span>
                )}
              </div>
            </div>
          </div>

          <div className="border-t border-border px-4 py-3 dark:border-border-dark">
            <CloudAccountSection
              onNavigate={() => closeMenu()}
              registerItem={(index) => (element) => {
                menuItemRefs.current[index] = element;
              }}
              startIndex={0}
            />
          </div>
        </div>
      )}
    </div>
  );
}
