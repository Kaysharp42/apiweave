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

const URL_WITH_SCHEME = /^(?:https|ssh|file):\/\/\S+$/i
/** A host cannot start with `-`: ssh would read `-oProxyCommand=…` as an option. */
const SCP_LIKE_URL = /^[\w.~-]+@[^\s@:/-][^\s@:/]*:\S+$/
/** The WHATWG parser and git/curl read these differently, and a query string is where a token would hide. */
const URL_PARSER_DISAGREEMENT = /[\\?#]/

const ACCEPTED_FORMS_MESSAGE =
  "A remote URL must be https://…, ssh://…, file://… or scp-like user@host:path. Plain http:// is not accepted."

const CREDENTIALS_MESSAGE =
  "A remote URL must not carry a user name or password: it is stored in plain text. " +
  "Use an SSH URL, or let git's credential helper authenticate."

/**
 * Checked on the parsed URL: no `\`, `?` or `#`; no host or user name starting
 * with `-`; only `ssh://` may name a user, and none may carry a password
 * (`git@host` is an account name, anything else in the userinfo is a
 * credential). A URL the parser cannot read cannot be checked, so it is refused
 * with the forms.
 */
function assertPlainSchemeUrl(url: string): void {
  if (URL_PARSER_DISAGREEMENT.test(url)) {
    throw new GitInvalidArgumentError("A remote URL must not contain '\\', '?' or '#'.")
  }
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    throw new GitInvalidArgumentError(ACCEPTED_FORMS_MESSAGE)
  }
  if (parsed.hostname.startsWith("-") || parsed.username.startsWith("-")) {
    throw new GitInvalidArgumentError("A remote URL's host and user name must not start with '-'.")
  }
  if (parsed.password !== "" || (parsed.username !== "" && parsed.protocol !== "ssh:")) {
    throw new GitInvalidArgumentError(CREDENTIALS_MESSAGE)
  }
}

/**
 * The remote URL a user may give a workspace: `https://`, `ssh://`, `file://`
 * or scp-like `user@host:path`, each with something after it and no
 * whitespace. Plain `http://` and `git://` carry the workspace unencrypted and
 * are refused with the rest, and so is anything git would read as a local path.
 * The URL is stored in plain text, so one carrying a password, a query string,
 * or a user name other than an `ssh://` account is refused too, and so is a
 * host or user name that starts with `-`.
 * Returns the trimmed URL, which is what is stored and handed to git.
 */
export function assertWorkspaceRemoteUrl(url: string): string {
  const trimmed = url.trim()
  assertPlainText("remote URL", trimmed)
  assertSafeRemoteUrl(trimmed)
  if (URL_WITH_SCHEME.test(trimmed)) {
    assertPlainSchemeUrl(trimmed)
  } else if (!SCP_LIKE_URL.test(trimmed)) {
    throw new GitInvalidArgumentError(ACCEPTED_FORMS_MESSAGE)
  }
  return trimmed
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
