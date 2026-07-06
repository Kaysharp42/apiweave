import {
  useEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import { useNavigate } from "react-router-dom";
import { BadgeCheck, LogOut } from "lucide-react";
import { useAuth } from "../../auth/useAuth";
import { Button } from "../atoms/Button";
import {
  getAccountDisplayName,
  getAccountInitials,
  getRoleSummary,
} from "./accountMenuUtils";

export function AccountMenu() {
  const { user, isAuthenticated, logout } = useAuth();
  const navigate = useNavigate();
  const [open, setOpen] = useState(false);
  const [avatarFailed, setAvatarFailed] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuItemRefs = useRef<
    Array<HTMLAnchorElement | HTMLButtonElement | null>
  >([]);

  useEffect(() => {
    setAvatarFailed(false);
  }, [user?.avatar_url]);

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

  const displayName = getAccountDisplayName(user);
  const initials = getAccountInitials(user, displayName);
  const roleSummary = getRoleSummary(user);
  const avatarVisible = Boolean(user.avatar_url) && !avatarFailed;

  const closeMenu = (focusTrigger = false) => {
    setOpen(false);
    if (focusTrigger) {
      triggerRef.current?.focus();
    }
  };

  const focusMenuItem = (index: number) => {
    const item = menuItemRefs.current[index];
    item?.focus();
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
      requestAnimationFrame(() => focusMenuItem(0));
    }

    if (event.key === "Escape") {
      event.preventDefault();
      closeMenu(true);
    }
  };

  const handleLogout = async () => {
    closeMenu();
    await logout();
    navigate("/app", { replace: true });
  };

  return (
    <div className="relative" ref={wrapperRef}>
      <Button
        ref={triggerRef}
        variant="ghost"
        size="sm"
        onClick={() => setOpen((prev) => !prev)}
        onKeyDown={handleTriggerKeyDown}
        className="h-9 w-9 overflow-hidden rounded-full border border-border bg-surface-raised p-0 hover:bg-surface-overlay dark:border-border-dark dark:bg-surface-dark-raised dark:hover:bg-surface-dark-overlay"
        aria-label={`Account menu for ${displayName}`}
        aria-haspopup="menu"
        aria-expanded={open}
        title={displayName}
      >
        {avatarVisible ? (
          <img
            src={user.avatar_url ?? undefined}
            alt={displayName}
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
          className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded border border-border bg-surface-raised dark:border-border-dark dark:bg-surface-dark-raised"
          role="menu"
          aria-label="Account actions"
        >
          <div className="border-b border-border px-4 py-3 dark:border-border-dark">
            <div className="flex items-center gap-3">
              <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-full bg-primary/10 dark:bg-primary-light/10">
                {avatarVisible ? (
                  <img
                    src={user.avatar_url ?? undefined}
                    alt={displayName}
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
                  {displayName}
                </div>
                <div className="mt-0.5 flex items-center gap-1.5 text-xs text-text-secondary dark:text-text-secondary-dark">
                  <CheckCircleLine />
                  <span className="truncate">Verified email</span>
                </div>
                <div className="truncate text-xs text-text-muted dark:text-text-muted-dark">
                  {user.verified_email}
                </div>
                <div className="mt-1 text-xs text-text-secondary dark:text-text-secondary-dark">
                  {roleSummary}
                </div>
              </div>
            </div>
          </div>

          <div className="py-1">
            <Button
              ref={(element) => {
                menuItemRefs.current[0] = element;
              }}
              role="menuitem"
              variant="ghost"
              intent="error"
              size="sm"
              onClick={() => void handleLogout()}
              className="w-full justify-start rounded-none px-4 py-2 text-sm"
            >
              <LogOut className="w-4 h-4" />
              Sign out
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function CheckCircleLine() {
  return (
    <BadgeCheck className="h-3.5 w-3.5 text-status-success dark:text-status-success-dark" />
  );
}
