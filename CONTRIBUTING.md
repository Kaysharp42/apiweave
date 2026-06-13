# Contributing

Thanks for your interest in making APIWeave better. This page covers how to report issues, request features, submit changes, and where to send security reports.

## Filing Issues

File bug reports on GitHub Issues. Search the existing list first; a duplicate with extra context beats a "+1" comment.

A good bug report includes:

- Steps to reproduce, in order
- What you expected to happen
- What actually happened (error text, screenshots, relevant logs from `backend/logs/`)
- Your environment: OS, Python version, Node version, MongoDB version
- Whether the issue is consistent or intermittent

## Security Issues

Do not file security vulnerabilities on GitHub Issues. Public disclosure gives attackers a head start before a fix lands.

Report privately through GitHub Security Advisories for this repository, or email the maintainers at the address listed in the repo's security contact. Include the vulnerability, its impact, and a proof of concept or reproduction steps. We aim to acknowledge reports within two business days and will coordinate disclosure timing with you.

## Feature Requests

Open a GitHub Issue with the `enhancement` label. Describe the problem you are trying to solve rather than the specific solution you have in mind. A clear problem statement often surfaces a better fix, and helps others see whether they share the need.

## Pull Requests

Open a pull request against the `main` branch. For development setup, scripts, lint, test, and build commands, see `apiweave-context.md` at the repo root. That file is the single source of truth for the development workflow and is updated as the project evolves; this page does not duplicate it.

Before opening a PR:

- One focused change per PR. Stack larger work as a series of smaller PRs.
- Match the existing code style. Lint and typecheck must pass cleanly.
- Add or update tests for the change.
- Update docs under `docs/` when user-facing behavior changes.

The PR description should explain the why. The diff already shows the what.

## Code of Conduct

Participation is governed by the Contributor Covenant. Read the full text at [contributor-covenant.org](https://www.contributor-covenant.org/). Report conduct violations to the maintainers privately.

## Related

- [Project README](README.md)
- [Documentation Hub](docs/README.md)
- [Security Guide](docs/SECURITY.md)
- [FAQ and Troubleshooting](docs/FAQ_TROUBLESHOOTING.md)
