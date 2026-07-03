/**
 * Routes that should keep the "settings" nav section active (settings sidebar
 * shown, Settings rail item highlighted). Kept in one place so MainLayout and
 * AppNavBar can't drift — drift here silently flips the sidebar back to
 * workflows (e.g. /organizations was missing and reverted on landing).
 */
export const isSettingsRoute = (pathname: string): boolean =>
  pathname.includes("/settings/") ||
  pathname.endsWith("/settings") ||
  pathname === "/audit" ||
  pathname === "/organizations" ||
  pathname.startsWith("/organizations/");
