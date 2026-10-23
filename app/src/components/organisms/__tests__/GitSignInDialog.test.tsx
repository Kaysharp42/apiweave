import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import { GitSignInDialog } from "../GitSignInDialog";
import { installGitBridge, untrackedStatus } from "../../../__tests__/gitFixtures";

const ACCOUNT: GitAccountRef = { provider: "github", host: "github.com", login: "octo" };
const PROMPT = { provider: "github" as const, host: "github.com", code: "3F2A-9C1B", url: "https://github.com/login/device" };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** A sign-in the test finishes, or fails, when it chooses. */
function pending() {
  let resolve: (account: GitAccountRef) => void = () => undefined;
  let reject: (error: Error) => void = () => undefined;
  const signIn = vi.fn(
    () =>
      new Promise<GitAccountRef>((ok, fail) => {
        resolve = ok;
        reject = fail;
      }),
  );
  return { signIn, resolve: (account: GitAccountRef) => resolve(account), reject: (error: Error) => reject(error) };
}

function renderDialog(provider: "github" | "gitlab" = "github", defaultHost = "github.com") {
  const onClose = vi.fn();
  const onSignedIn = vi.fn();
  render(<GitSignInDialog isOpen provider={provider} defaultHost={defaultHost} onClose={onClose} onSignedIn={onSignedIn} />);
  return { onClose, onSignedIn };
}

describe("GitSignInDialog", () => {
  it("says what gh will change before it runs, then shows the code, reopens the page, and reports who signed in", async () => {
    const user = userEvent.setup();
    const run = pending();
    const { bridge, prompt } = installGitBridge(untrackedStatus, { signIn: run.signIn });
    const { onSignedIn } = renderDialog();

    expect(screen.getByText(/gh makes this account its active account on github\.com/)).toBeInTheDocument();
    expect(screen.getByText(/Your git configuration is not changed/)).toBeInTheDocument();
    expect(run.signIn).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: /sign in in the browser/i }));

    expect(bridge.signIn).toHaveBeenCalledWith("github", "github.com");
    expect(screen.getByText(/Starting gh/)).toBeInTheDocument();
    const again = screen.getByRole("button", { name: /open browser again/i });
    expect(again).toBeDisabled();

    act(() => prompt({ ...PROMPT, host: "elsewhere.example" }));
    expect(screen.queryByLabelText("One-time code")).toBeNull();
    act(() => prompt(PROMPT));
    expect(screen.getByLabelText("One-time code")).toHaveTextContent("3F2A-9C1B");
    await user.click(again);
    expect(bridge.openSignInPage).toHaveBeenCalledOnce();

    await act(async () => run.resolve(ACCOUNT));
    expect(await screen.findByText(/Signed in to github\.com as/)).toHaveTextContent("Signed in to github.com as octo.");
    expect(onSignedIn).toHaveBeenCalledWith(ACCOUNT);
    expect(bridge.cancelSignIn).not.toHaveBeenCalled();
  });

  it("cancels: the tool is stopped and the dialog closes once it has", async () => {
    const user = userEvent.setup();
    const run = pending();
    const { bridge } = installGitBridge(untrackedStatus, { signIn: run.signIn });
    const { onClose, onSignedIn } = renderDialog();

    await user.click(screen.getByRole("button", { name: /sign in in the browser/i }));
    await user.click(screen.getByRole("button", { name: /^cancel$/i }));

    expect(bridge.cancelSignIn).toHaveBeenCalledOnce();
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => run.reject(new Error("Sign-in was cancelled.")));
    expect(onClose).toHaveBeenCalledOnce();
    expect(onSignedIn).not.toHaveBeenCalled();
  });

  it("shows why a sign-in failed, and tries again on the host typed", async () => {
    const user = userEvent.setup();
    const run = pending();
    const { bridge } = installGitBridge(untrackedStatus, { signIn: run.signIn });
    renderDialog("gitlab", "gitlab.com");

    expect(screen.getByText(/glab keeps one account per host: this replaces any account it already has for gitlab\.com/)).toBeInTheDocument();
    const host = screen.getByRole("textbox", { name: "Host" });
    await user.clear(host);
    await user.type(host, "gitlab.example.com");
    await user.click(screen.getByRole("button", { name: /sign in in the browser/i }));
    await act(async () => run.reject(new Error("glab could not sign in to gitlab.example.com: failed to start device authorization")));

    expect(screen.getByRole("alert")).toHaveTextContent("failed to start device authorization");
    await user.click(screen.getByRole("button", { name: /try again/i }));
    expect(bridge.signIn).toHaveBeenLastCalledWith("gitlab", "gitlab.example.com");
  });
});
