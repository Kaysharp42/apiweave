# Environment Protection

*How to require reviewer approval for runs against a sensitive environment, how to allow or deny self-approval, and how to let a trusted service token bypass the gate when the CI/CD system is the runner.*

## Prerequisites

- [Concepts](../getting-started/concepts.md) for the environment, approval, and service token definitions used in this guide.
- [Environments and Secrets](../features/environments-and-secrets.md) for the environment lifecycle and the override chain.
- A workspace environment you want to protect. Organization and user environments are not protected in 2.0; only workspace environments carry a protection policy.
- A scoped service token for the CI/CD system, if you plan to use the trusted-token bypass.

## What Is Environment Protection

Environment protection is a policy attached to a workspace environment. The policy controls who must approve a run against that environment, whether the run initiator can self-approve, and whether a trusted service token can skip the gate. A protected environment queues a run behind a `pending` approval record; the run executes once every required reviewer approves, the run is denied, or a bypass kicks in.

Protection is opt-in per environment. A workspace can hold a mix of protected and unprotected environments. The default for a new environment is unprotected.

## The Protection Policy

A protection policy carries four fields:

| Field | Description |
|-------|-------------|
| `requiredReviewers` | List of user ids or team ids that must approve before the run starts. Every reviewer in the list must approve. |
| `allowSelfApproval` | If `true`, the run initiator counts as a reviewer and can approve their own run. If `false`, the initiator cannot approve and must wait for another reviewer. |
| `bypassPolicy` | One of `none` or `trusted_token_only`. The `trusted_token_only` policy means a service token on the allowlist can skip the gate. |
| `bypassAllowlist` | List of service token ids that are allowed to bypass the gate when `bypassPolicy = trusted_token_only`. |

The policy is editable from the environment settings page. Every change is an audit event with the actor, the before and after values, and the timestamp. The previous policy is not retained; treat the audit log as the history.

## Required Reviewers

Required reviewers are the human and team approvals the run needs before it can start. The list accepts both user ids (specific individuals) and team ids (any member of the team). A reviewer who is also a member of a listed team counts once; the policy deduplicates by reviewer.

A required reviewer must be a member of the workspace. An outside collaborator can be a required reviewer if they have the `environment:approve` permission on the workspace. The UI rejects a reviewer who is not eligible with a clear error before saving.

A run against a protected environment creates a `pending approval` record that lists every required reviewer. The record is visible on the environment's approvals page and on the run's status page. Each reviewer has an `approved`, `denied`, or `pending` state.

A run with a required-reviewer list of zero is treated as auto-approved at creation time. The protection is effectively off. If you want the run to wait, add at least one reviewer.

## Self-Approval

`allowSelfApproval` controls whether the run initiator counts as a reviewer. The default is `false`, which means the run initiator cannot approve their own run and must wait for another reviewer.

`allowSelfApproval = true` is the right choice when the environment is a personal development or staging space and the same person runs and approves. For a shared staging or production environment, leave it `false` so a second pair of eyes is mandatory.

The setting is enforced server-side. A user cannot "self-approve" by manipulating the UI; the backend checks the actor of the approval against the actor of the run and rejects a self-approval when the setting is `false`.

## Bypass Policy

`bypassPolicy` controls whether a service token can skip the gate without going through human approval. The two values are:

- `none`: no bypass. Every run against the environment goes through the approval queue, including runs triggered by a service token.
- `trusted_token_only`: a service token on `bypassAllowlist` can skip the gate. The run starts as soon as the trigger arrives.

The trusted-token bypass is the right choice for a CI/CD pipeline that runs the same well-tested suite on every commit. The trust comes from the narrow permission set on the token and from the allowlist entry; the trust does not extend to a human user.

`bypassAllowlist` lists the service token ids that can bypass. Tokens on the allowlist are recorded in the audit log when they bypass the gate, with the actor type `service_token` and the token id. The audit event is the proof that a CI run skipped the gate.

A token can be on multiple environments' allowlists. The token is not granted additional permissions by the allowlist; the token's own permission set is what limits what it can do on the workspace. A read-only token on the allowlist can still only read, even if it bypasses the gate.

## Pending Approvals

A pending approval is the queue of required reviewers for a run against a protected environment. The queue lives on the environment's approvals page and on the run's status page.

Each reviewer in the queue can take one of three actions:

- **Approve**: marks the reviewer as `approved`. The run starts once every required reviewer has approved.
- **Deny**: marks the reviewer as `denied`. The run is canceled. A single denial cancels the run; the other reviewers' states are not relevant.
- **Skip**: leaves the reviewer in `pending`. The reviewer has not yet acted.

The initiator of the run sees the queue on the run's status page. Other required reviewers see the queue on the environment's approvals page. The audit log records every action with the actor and the timestamp.

A run whose approvals are still pending cannot be resumed. The run is canceled by a denial, or it starts once the last required approval lands. A resumed run against a protected environment re-enters the approval queue with the same reviewer list.

## Editing the Policy

Editing the policy is a workspace action that requires the `environment:write` and `environment:protection:write` permissions. The edit form lives on the environment settings page.

When you change the reviewer list, the change applies to runs created after the edit. In-flight approvals are not retroactively re-queued. A reviewer you remove from the list is taken out of any current queue; their pending state is recorded as `removed` in the audit log.

When you change `bypassPolicy` from `none` to `trusted_token_only`, tokens on the allowlist start bypassing on the next run. There is no warm-up window. When you change it back, the bypass stops immediately and the next run goes through the queue.

When you change `allowSelfApproval` from `false` to `true`, the next run that the current user initiates counts them as a reviewer. A run that the current user already initiated before the change does not retroactively auto-approve.

## Recommended Patterns

- **Production**: required reviewers = a small team with merge rights on the release; `allowSelfApproval = false`; `bypassPolicy = trusted_token_only` with a narrow token bound to the release pipeline; allowlist limited to that one token.
- **Staging**: required reviewers = the developer who triggered the run; `allowSelfApproval = true`; `bypassPolicy = none` so every run is visible in the queue.
- **Personal preview**: no required reviewers, `allowSelfApproval = true`, `bypassPolicy = none`. The protection is effectively off but the policy is in place to lock down later.

## Troubleshooting

- **If a run is stuck in `pending approval` and you expected it to start**, open the approvals page and check the reviewer list. At least one required reviewer has not approved. Either collect the approval or add a service token to the bypass allowlist and re-trigger.
- **If a self-approval is rejected**, `allowSelfApproval` is `false` for the environment. Either flip the policy (workspace owner action) or wait for another reviewer.
- **If a service token cannot bypass the gate**, the token is not on the `bypassAllowlist` or `bypassPolicy` is `none`. Add the token id to the allowlist and confirm the policy is `trusted_token_only`. The audit log records the failed bypass attempt.
- **If a reviewer is removed from the list while a run is queued**, the reviewer is taken out of the current queue. The run continues with the remaining reviewers. The audit log shows the removal and the new queue.
- **If the audit log shows a bypass you did not expect**, the token id in the event tells you which service token bypassed. Rotate or revoke the token, then audit the recent runs for that token.

## Related

- [Environments and Secrets](../features/environments-and-secrets.md) for the environment lifecycle and the override chain.
- [MCP Integration](../features/mcp-integration.md) for the scoped service tokens that the bypass policy references.
- [Webhooks](../features/webhooks.md) for the CI/CD triggers that often run against protected environments.
- [Audit Log](audit.md) for the events that every policy change and every approval writes.
