# Host CLI fixtures

What `gh` and `glab` print, for the parsers and `HostCliService` tests. Tokens,
logins, ids and repository names are redacted.

| File | Source |
|---|---|
| `gh-auth-status.json` | Recorded: `gh auth status --json hosts`, gh 2.97. |
| `gh-repo.json` | Recorded: `gh api repos/{owner}/{repo}`, gh 2.97, trimmed. `POST /user/repos` and `POST /orgs/{org}/repos` answer with the same full-repository object (docs.github.com/rest/repos/repos). |
| `gh-user-orgs.json` | Recorded: `gh api user/orgs?per_page=100`, gh 2.97. |
| `gh-repo-list.json` | Recorded shape: `gh repo list <owner> --no-archived --json name,nameWithOwner,url,sshUrl,isEmpty,viewerPermission,visibility`, gh 2.97. Neither account had an empty repository, so the two `isEmpty: true` entries are written in the recorded shape. |
| `gitlab-project.json` | From the docs, not recorded (glab is not installed on the dev machine): the `POST /projects` / `GET /projects/:id` response in docs.gitlab.com/api/projects, trimmed to the fields read and the ones beside them. |

Error bodies are inline in the tests. GitHub's 404 (`{"message":"Not Found",…,"status":"404"}` on stdout,
`gh: Not Found (HTTP 404)` on stderr, exit 1) is recorded from gh 2.97. glab's shapes come from its source
(`internal/commands/api/api.go`: the body on stdout, `glab: <message> (HTTP <code>)` on stderr) and GitLab's
validation-error format from docs.gitlab.com/api/rest/troubleshooting.
