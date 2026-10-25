import { useState } from "react";
import { Button } from "../atoms/Button";
import { Input } from "../atoms/Input";
import { FormField } from "../molecules/FormField";
import type { GitAuthorFormProps } from "../../types";

/**
 * Asked for when git reports no author: written into this workspace's own
 * repository only (`git config --local`), then the commit is retried. Used
 * wherever a commit has to happen and git does not know who is making it.
 */
export function GitAuthorForm({ busy, onCommit }: GitAuthorFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  return (
    <form
      className="space-y-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onCommit({ identity: { name, email } });
      }}
    >
      <p className="text-sm text-text-secondary dark:text-text-secondary-dark">
        Git doesn&apos;t know who you are on this machine. Commits in this
        workspace&apos;s history will name the author below.
      </p>
      <FormField label="Your name" required>
        <Input
          aria-label="Your name"
          value={name}
          onChange={(event) => setName(event.target.value)}
          autoComplete="name"
        />
      </FormField>
      <FormField label="Your email address" required>
        <Input
          aria-label="Your email address"
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          autoComplete="email"
        />
      </FormField>
      <Button type="submit" variant="primary" loading={busy} disabled={name.trim() === "" || email.trim() === ""}>
        Save and commit
      </Button>
    </form>
  );
}
