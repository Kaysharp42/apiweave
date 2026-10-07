import type { User } from "./User";

/** The desktop app has one local owner and no sign-in. */
export interface AuthContextValue {
  user: User;
}
