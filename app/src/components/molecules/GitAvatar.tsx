import { useState } from "react";
import { gitAccountInitials, gitAvatarUrl } from "../../utils/gitAccounts";
import type { GitAvatarProps } from "../../types";

/**
 * An account's profile picture, or its initials until the picture
 * loads and for good when it cannot (offline, or a host that wants a sign-in
 * for it). Decorative: the account's login is always written beside it.
 */
export function GitAvatar({ account, className = "h-8 w-8 rounded-full text-xs" }: GitAvatarProps) {
  const url = gitAvatarUrl(account);
  // Keyed by the address it failed for, so another account's picture is tried afresh.
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const [loadedUrl, setLoadedUrl] = useState<string | null>(null);
  const showImage = url !== null && failedUrl !== url;
  const imageLoaded = showImage && loadedUrl === url;

  return (
    <span
      aria-hidden="true"
      className={`relative flex shrink-0 select-none items-center justify-center overflow-hidden bg-primary/10 font-semibold text-primary dark:bg-primary-light/10 dark:text-primary-light ${className}`}
    >
      {!imageLoaded && gitAccountInitials(account.login)}
      {showImage && (
        <img
          key={url}
          src={url}
          alt=""
          draggable={false}
          referrerPolicy="no-referrer"
          onLoad={() => setLoadedUrl(url)}
          onError={() => setFailedUrl(url)}
          className={`absolute inset-0 h-full w-full object-cover ${imageLoaded ? "" : "opacity-0"}`}
        />
      )}
    </span>
  );
}
