export interface SettingsContentProps {
  hasPermission: (permission: string) => boolean;
  onNavigate: (path: string) => void;
}