import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import type { GitAccountRef } from "@shared/types/GitAccountRef";
import { useGitRepositoryList } from "./useGitRepositoryList";
import { installGitBridge, untrackedStatus } from "../__tests__/gitFixtures";

afterEach(() => {
  vi.unstubAllGlobals();
});

const WORK: GitAccountRef = { provider: "github", host: "github.com", login: "octo-work" };
const LAB: GitAccountRef = { provider: "gitlab", host: "gitlab.com", login: "tanuki" };
const CONNECT = { tagged: false, emptyOnly: true };

describe("useGitRepositoryList", () => {
  it("lists each account once while mounted, and again on refresh", async () => {
    const { bridge } = installGitBridge(untrackedStatus, {
      listRepositories: vi.fn(async () => ({ repositories: [], problems: ["acme: only the first 100 repositories are listed."] })),
    });
    const { result, rerender } = renderHook(({ account }) => useGitRepositoryList(account, CONNECT), { initialProps: { account: WORK } });

    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.problems).toEqual(["acme: only the first 100 repositories are listed."]);
    rerender({ account: LAB });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ account: { ...WORK } });
    expect(result.current.loading).toBe(false);
    expect(bridge.listRepositories).toHaveBeenCalledTimes(2);

    act(() => result.current.refresh());
    await waitFor(() => expect(bridge.listRepositories).toHaveBeenCalledTimes(3));
  });

  it("says why a list could not be read, and asks again rather than keeping the failure", async () => {
    const { bridge } = installGitBridge(untrackedStatus, {
      listRepositories: vi.fn().mockRejectedValueOnce(new Error("gh could not sign in to github.com as octo-work")).mockResolvedValue({ repositories: [], problems: [] }),
    });
    const { result, rerender } = renderHook(({ account }) => useGitRepositoryList(account, CONNECT), { initialProps: { account: WORK as GitAccountRef | null } });

    await waitFor(() => expect(result.current.problems).toEqual(["The repositories could not be listed: gh could not sign in to github.com as octo-work"]));
    rerender({ account: null });
    rerender({ account: WORK });
    await waitFor(() => expect(result.current.problems).toEqual([]));
    expect(bridge.listRepositories).toHaveBeenCalledTimes(2);
  });

  it("waits on a listing still running when the account is switched away and back", async () => {
    let finishA: (list: { repositories: never[]; problems: string[] }) => void = () => undefined;
    const listRepositories = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishA = resolve; }))
      .mockResolvedValue({ repositories: [], problems: [] });
    const { bridge } = installGitBridge(untrackedStatus, { listRepositories });
    const { result, rerender } = renderHook(({ account }) => useGitRepositoryList(account, CONNECT), { initialProps: { account: WORK as GitAccountRef | null } });

    expect(result.current.loading).toBe(true);
    rerender({ account: LAB });
    await waitFor(() => expect(result.current.loading).toBe(false));
    rerender({ account: { ...WORK } });
    // A's question was never answered and never replaced: the answer still belongs to it.
    expect(result.current.loading).toBe(true);
    act(() => finishA({ repositories: [], problems: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(bridge.listRepositories).toHaveBeenCalledTimes(2);
  });
  it("keeps the list it was refreshed to when an older answer lands late", async () => {
    let finishOld: (list: { repositories: never[]; problems: never[] }) => void = () => undefined;
    const listRepositories = vi
      .fn()
      .mockImplementationOnce(() => new Promise((resolve) => { finishOld = resolve; }))
      .mockResolvedValueOnce({ repositories: [], problems: [] });
    installGitBridge(untrackedStatus, { listRepositories });
    const { result } = renderHook(() => useGitRepositoryList(WORK, CONNECT));

    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.loading).toBe(false));
    act(() => finishOld({ repositories: [], problems: [] }));

    // The refreshed ask is the one whose answer is kept; the older one is dropped.
    expect(listRepositories).toHaveBeenCalledTimes(2);
    expect(result.current.failed).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("hides the failure it is replacing while it asks again", async () => {
    let finishRetry: (list: { repositories: never[]; problems: never[] }) => void = () => undefined;
    const listRepositories = vi
      .fn()
      .mockRejectedValueOnce(new Error("gh could not sign in"))
      .mockImplementationOnce(() => new Promise((resolve) => { finishRetry = resolve; }));
    installGitBridge(untrackedStatus, { listRepositories });
    const { result } = renderHook(() => useGitRepositoryList(WORK, CONNECT));

    await waitFor(() => expect(result.current.problems).toEqual(["The repositories could not be listed: gh could not sign in"]));
    act(() => result.current.refresh());

    expect(result.current.problems).toEqual([]);
    expect(result.current.loading).toBe(true);
    act(() => finishRetry({ repositories: [], problems: [] }));
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.problems).toEqual([]);
  });});
