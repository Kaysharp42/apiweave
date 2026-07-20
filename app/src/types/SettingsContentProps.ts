import type { NavSection } from "./NavSection";

export interface SettingsContentProps {
  onNavigate: (path: string) => void;
  onSwitchNav: (section: NavSection) => void;
}
