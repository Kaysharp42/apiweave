/**
 * Routes that render the tutorial page over the persistent canvas. Kept in one
 * place so `AppNavBar` can treat "leave the covered surface" uniformly instead
 * of testing the path in several components.
 */
export const isTutorialRoute = (pathname: string): boolean =>
  pathname.includes("/tutorials");
