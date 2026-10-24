import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitAccount } from "@shared/types/GitAccount";
import { CreateRepositoryDialog } from "../CreateRepositoryDialog";
import { installGitBridge, untrackedStatus } from "../../../__tests__/gitFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const WORK: GitAccount = { provider: "github", host: "github.com", login: "octo-work", gitProtocol: "https", active: true, problem: null };
const LAB: GitAccount = { provider: "gitlab", host: "gitlab.com", login: "tanuki", gitProtocol: "https", active: true, problem: null };

function renderDialog(defaultAccount: GitAccount | null = null) {
  const onCreated = vi.fn();
  render(<CreateRepositoryDialog onClose={vi.fn()} defaultName="shop-api" defaultAccount={defaultAccount} onCreated={onCreated} />);
  return { onCreated };
}

describe("CreateRepositoryDialog", () => {
  it("asks for a sign-in when no account is signed in", async () => {
    installGitBridge(untrackedStatus);
    renderDialog();

    expect(await screen.findByText(/Sign in to GitHub or GitLab first/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Sign in to GitLab…" }));
    expect(await screen.findByRole("dialog", { name: "Sign in to GitLab" })).toBeInTheDocument();
  });

  it("starts on the workspace's account and lists its organizations and groups as owners", async () => {
    installGitBridge(untrackedStatus, {
      listAccounts: vi.fn(async () => ({ clis: [], accounts: [WORK, LAB] })),
      listOwners: vi.fn(async () => ({
        owners: [
          { path: "tanuki", kind: "user" as const },
          { path: "acme/qa", kind: "group" as const },
        ],
        problem: null,
      })),
    });
    const { onCreated } = renderDialog(LAB);

    const owner = await screen.findByRole("combobox", { name: "Owner" });
    expect(screen.getByRole("combobox", { name: "Account" })).toHaveValue("gitlab|gitlab.com|tanuki");
    await vi.waitFor(() => expect(owner).toHaveValue("tanuki"));
    await userEvent.selectOptions(owner, "acme/qa");
    await userEvent.selectOptions(screen.getByRole("combobox", { name: "Visibility" }), "public");
    await userEvent.click(screen.getByRole("button", { name: "Create and connect" }));

    await vi.waitFor(() => expect(onCreated).toHaveBeenCalledOnce());
    expect(onCreated.mock.calls[0]?.[1]).toEqual(LAB);
  });

  it("says why an account's organizations could not be listed, and still offers the account itself", async () => {
    installGitBridge(untrackedStatus, {
      listAccounts: vi.fn(async () => ({ clis: [], accounts: [WORK] })),
      listOwners: vi.fn(async () => ({
        owners: [{ path: "octo-work", kind: "user" as const }],
        problem: "The organizations of octo-work could not be listed: Bad credentials",
      })),
    });
    renderDialog();

    const dialog = await screen.findByRole("dialog", { name: "Create repository" });
    expect(await within(dialog).findByText("The organizations of octo-work could not be listed: Bad credentials")).toBeInTheDocument();
    expect(within(dialog).getByRole("combobox", { name: "Owner" })).toHaveValue("octo-work");
  });
});
