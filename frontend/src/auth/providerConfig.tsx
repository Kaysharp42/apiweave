import type { SVGProps } from "react";
import { Fingerprint, Github, Gitlab } from "lucide-react";
import type { ProviderInfo } from "../types";
import type { ProviderId, ProviderDisplay } from "../types";

export type { ProviderId, ProviderDisplay };
export const PROVIDER_IDS = [
  "github",
  "gitlab",
  "google",
  "microsoft",
] as const;

type ProviderIconProps = SVGProps<SVGSVGElement>;

function GoogleIcon(props: ProviderIconProps) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M21.35 11.1H12v2.97h5.34c-.23 1.29-.97 2.38-2.06 3.11v2.58h3.33c1.95-1.8 3.08-4.46 3.08-7.62 0-.74-.06-1.45-.17-2.04Z" />
      <path d="M12 22c2.77 0 5.1-.92 6.8-2.48l-3.33-2.58c-.92.62-2.1.98-3.47.98-2.67 0-4.94-1.8-5.75-4.22H2.82v2.65A10 10 0 0 0 12 22Z" />
      <path d="M6.25 13.7a6 6 0 0 1 0-3.4V7.65H2.82a10 10 0 0 0 0 8.4l3.43-2.35Z" />
      <path d="M12 5.75c1.5 0 2.84.52 3.9 1.54l2.92-2.92A9.8 9.8 0 0 0 12 2a10 10 0 0 0-9.18 5.65l3.43 2.65C7.07 7.56 9.33 5.75 12 5.75Z" />
    </svg>
  );
}

export const PROVIDER_DISPLAY_MAP: Record<ProviderId, ProviderDisplay> = {
  github: {
    id: "github",
    label: "Continue with GitHub",
    IconComponent: Github,
  },
  gitlab: {
    id: "gitlab",
    label: "Continue with GitLab",
    IconComponent: Gitlab,
  },
  google: {
    id: "google",
    label: "Continue with Google",
    IconComponent: GoogleIcon,
  },
  microsoft: {
    id: "microsoft",
    label: "Continue with Microsoft",
    IconComponent: Fingerprint,
  },
};

export function getProviderDisplay(id: string): ProviderDisplay | undefined {
  return PROVIDER_DISPLAY_MAP[id as ProviderId];
}

export function getEnabledProviders(
  availability: ProviderInfo[],
): ProviderDisplay[] {
  return availability.reduce<ProviderDisplay[]>((providers, provider) => {
    if (!provider.enabled) return providers;
    const display = getProviderDisplay(provider.id);
    if (display) providers.push(display);
    return providers;
  }, []);
}
