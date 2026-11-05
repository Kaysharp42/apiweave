import { lazy, type LazyExoticComponent, type ReactNode } from "react";

/**
 * `React.lazy` for a component that is a named export.
 *
 * `lazy` only accepts a module whose `default` is the component; this picks the
 * named one out instead. The caller still writes the `import()` itself, so the
 * bundler sees a literal specifier and splits the chunk as before.
 */
export function lazyNamed<Name extends string, Props, Result extends ReactNode>(
  load: () => Promise<Record<Name, (props: Props) => Result>>,
  name: Name,
): LazyExoticComponent<(props: Props) => Result> {
  return lazy(() => load().then((module) => ({ default: module[name] })));
}
