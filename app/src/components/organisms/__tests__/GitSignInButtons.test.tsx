import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitHostCli } from "@shared/types/GitHostCli";
import { GitSignInButtons } from "../GitSignInButtons";

const gh: GitHostCli = { provider: "github", command: "gh", missing: false, version: "2.97.0", problem: null };
const glab: GitHostCli = { provider: "gitlab", command: "glab", missing: false, version: "1.46.1", problem: null };

describe("GitSignInButtons", () => {
  it("offers both sign-ins when both tools are installed", () => {
    render(<GitSignInButtons clis={[gh, glab]} onSignedIn={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sign in to GitHub…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign in to GitLab…" })).toBeEnabled();
    expect(screen.queryByText(/install them from/)).toBeNull();
  });

  it("offers no sign-in with a tool that is not installed, and says where to get both when neither is", () => {
    render(<GitSignInButtons clis={[{ ...gh, missing: true, version: null }, { ...glab, missing: true, version: null }]} onSignedIn={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sign in to GitHub…" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Sign in to GitLab…" })).toBeDisabled();
    expect(screen.getByRole("link", { name: "cli.github.com" })).toHaveAttribute("href", "https://cli.github.com");
    expect(screen.getByRole("link", { name: "gitlab.com/gitlab-org/cli" })).toHaveAttribute("href", "https://gitlab.com/gitlab-org/cli");
  });

  it("still offers a sign-in when only the other tool is missing, and says nothing about installing", () => {
    render(<GitSignInButtons clis={[gh, { ...glab, missing: true, version: null }]} onSignedIn={vi.fn()} />);

    expect(screen.getByRole("button", { name: "Sign in to GitHub…" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Sign in to GitLab…" })).toBeDisabled();
    expect(screen.queryByText(/install them from/)).toBeNull();
  });

  it("opens the dialog for the provider it is for", async () => {
    render(<GitSignInButtons clis={[gh, glab]} onSignedIn={vi.fn()} />);

    await userEvent.click(screen.getByRole("button", { name: "Sign in to GitLab…" }));

    expect(await screen.findByRole("dialog", { name: "Sign in to GitLab" })).toBeInTheDocument();
  });
});
