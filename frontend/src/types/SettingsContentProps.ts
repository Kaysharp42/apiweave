import type { NavSection } from './NavSection';

export interface SettingsContentProps {
  hasPermission: (permission: string) => boolean;
  onNavigate: (path: string) => void;
  onSwitchNav: (section: NavSection) => void;
}