import { GitInvalidArgumentError } from "./git_errors"

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/

/** Characters a branch or remote name cannot carry; the first one is also what makes `push` read `src:dst` as a refspec. */
const REF_NAME_FORBIDDEN = /[\s:~^?*[\\]/

/**
 * Git's own ref-name structure rules (`check-ref-format`): no `..`, no `@{`, no
 * leading, trailing or doubled `/`, no name ending `.`, and no slash-separated
 * component ending `.lock`. A revision is not a ref and may carry `..` or
 * `@{1}`; only this check refuses them.
 */
const REF_NAME_STRUCTURE = /\.\.|@\{|^\/|\/$|\/\/|\.$|(?:^|\/)[^/]*\.lock(?:\/|$)/

function assertPlainText(label: string, value: string): void {
  if (value.length === 0) {
    throw new GitInvalidArgumentError(`${label} is empty`)
  }
  if (CONTROL_CHARACTERS.test(value)) {
    throw new GitInvalidArgumentError(`${label} contains a control character`)
  }
}

/**
 * A remote URL reaches git as a positional argument, so a leading `-` would be an
 * option (`--upload-pack=…` runs a command), and `ext::` is the transport that
 * runs one. `--` and `protocol.ext.allow=never` guard the same two things at the
 * git end; this refuses them before git is started.
 */
export function assertSafeRemoteUrl(url: string): void {
  assertPlainText("remote URL", url)
  const probe = url.trimStart()
  if (probe.startsWith("-")) {
    throw new GitInvalidArgumentError("remote URL must not start with '-'")
  }
  if (/^ext::/i.test(probe)) {
    throw new GitInvalidArgumentError("the ext:: transport runs commands and is not allowed")
  }
}

/** A revision, range or `<rev>:<path>`: free-form, but never an option. Revisions cannot follow a `--`, which would make them paths. */
export function assertRevision(rev: string): void {
  assertPlainText("revision", rev)
  if (rev.startsWith("-")) {
    throw new GitInvalidArgumentError("revision must not start with '-'")
  }
}

/** A branch or remote name, which git requires to be a valid ref name. */
export function assertRefName(name: string): void {
  assertPlainText("name", name)
  if (name.startsWith("-") || REF_NAME_FORBIDDEN.test(name) || REF_NAME_STRUCTURE.test(name)) {
    throw new GitInvalidArgumentError(`'${name}' is not a plain branch or remote name`)
  }
}
