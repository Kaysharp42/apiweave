/**
 * A browser step's config as read: the action, its own fields, and its
 * locator. Nothing in it is written through this type.
 */
export type StepConfig = Readonly<Record<string, unknown>>;
