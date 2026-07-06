import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import LoginPage from "../pages/LoginPage";
import type { ProviderDisplay } from "../types";
import { Github, Gitlab } from "lucide-react";

const { mockAuthenticatedJson } = vi.hoisted(() => ({
  mockAuthenticatedJson: vi.fn(),
}));
vi.mock("../utils/apiweaveClient", () => ({
  default: "ipc://apiweave",
  authenticatedJson: (
    url: string,
    options?: RequestInit,
  ): Promise<{ message: string }> => mockAuthenticatedJson(url, options),
}));

// Mock useAuth
const mockLogin = vi.fn();
vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({
    login: mockLogin,
    status: "unauthenticated",
    user: null,
    error: null,
    isLoading: false,
    isAuthenticated: false,
    isSetupComplete: false,
    logout: vi.fn(),
    refresh: vi.fn(),
    hasPermission: vi.fn(),
  }),
}));

// Mock useOAuthProviders
const mockUseOAuthProviders = vi.fn();
vi.mock("../hooks/useOAuthProviders", () => ({
  useOAuthProviders: () => mockUseOAuthProviders(),
}));

// Mock react-router-dom
vi.mock("react-router-dom", () => ({
  Navigate: () => null,
  useSearchParams: () => [new URLSearchParams()],
}));

// Mock child components to simplify testing
vi.mock("../components/auth/SplitAuthLayout", () => ({
  SplitAuthLayout: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("../components/auth/AuthInteractiveHero", () => ({
  AuthInteractiveHero: () => <div>Hero</div>,
}));

vi.mock("../components/molecules/Card", () => ({
  Card: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

vi.mock("../components/molecules/EmptyState", () => ({
  EmptyState: ({
    title,
    description,
  }: {
    title: string;
    description: string;
  }) => (
    <div data-testid="empty-state">
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  ),
}));

vi.mock("../components/atoms/Spinner", () => ({
  Spinner: () => <div data-testid="spinner">Loading...</div>,
}));

describe("LoginPage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders empty state when no providers are configured", () => {
    mockUseOAuthProviders.mockReturnValue({
      providers: [],
      loading: false,
      error: null,
    });

    render(<LoginPage />);

    expect(
      screen.getByText(/No OAuth providers configured/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /continue with/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /send sign-in link/i }),
    ).toBeInTheDocument();
  });

  it("renders loading spinner while fetching providers", () => {
    mockUseOAuthProviders.mockReturnValue({
      providers: [],
      loading: true,
      error: null,
    });

    render(<LoginPage />);

    expect(screen.getByTestId("spinner")).toBeInTheDocument();
    expect(screen.getByText("Loading sign-in options...")).toBeInTheDocument();
  });

  it("renders error state when provider fetch fails", () => {
    mockUseOAuthProviders.mockReturnValue({
      providers: [],
      loading: false,
      error: "Unable to load sign-in options",
    });

    render(<LoginPage />);

    expect(screen.getByTestId("empty-state")).toBeInTheDocument();
    expect(screen.getByText("Sign-in options unavailable")).toBeInTheDocument();
  });

  it("renders one button per provider when providers are available", () => {
    const mockProviders: ProviderDisplay[] = [
      { id: "github", label: "Continue with GitHub", IconComponent: Github },
      { id: "gitlab", label: "Continue with GitLab", IconComponent: Gitlab },
    ];

    mockUseOAuthProviders.mockReturnValue({
      providers: mockProviders,
      loading: false,
      error: null,
    });

    render(<LoginPage />);

    const githubButton = screen.getByRole("button", {
      name: /continue with github/i,
    });
    const gitlabButton = screen.getByRole("button", {
      name: /continue with gitlab/i,
    });

    expect(githubButton).toBeInTheDocument();
    expect(gitlabButton).toBeInTheDocument();
    expect(githubButton).toHaveAttribute("data-provider", "github");
    expect(gitlabButton).toHaveAttribute("data-provider", "gitlab");
  });

  it("calls login with provider id when button is clicked", async () => {
    const user = userEvent.setup();
    const mockProviders: ProviderDisplay[] = [
      { id: "github", label: "Continue with GitHub", IconComponent: Github },
    ];

    mockUseOAuthProviders.mockReturnValue({
      providers: mockProviders,
      loading: false,
      error: null,
    });

    render(<LoginPage />);

    const githubButton = screen.getByRole("button", {
      name: /continue with github/i,
    });
    await user.click(githubButton);

    expect(mockLogin).toHaveBeenCalledWith("github");
  });

  it("requests an email magic link when the email form is submitted", async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson.mockResolvedValue({
      message:
        "If an account exists for that email, a sign-in link has been sent.",
    });
    mockUseOAuthProviders.mockReturnValue({
      providers: [],
      loading: false,
      error: null,
    });

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), "dev@example.com");
    await user.click(
      screen.getByRole("button", { name: /send sign-in link/i }),
    );

    expect(mockAuthenticatedJson).toHaveBeenCalledWith(
      expect.stringContaining("/api/auth/email/request"),
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "dev@example.com" }),
      },
    );
    expect(screen.getByText(/sign-in link has been sent/i)).toBeInTheDocument();
  });

  it("renders all four providers when available", () => {
    const mockProviders: ProviderDisplay[] = [
      { id: "github", label: "Continue with GitHub", IconComponent: Github },
      { id: "gitlab", label: "Continue with GitLab", IconComponent: Gitlab },
      { id: "google", label: "Continue with Google", IconComponent: Github }, // Using Github as placeholder
      {
        id: "microsoft",
        label: "Continue with Microsoft",
        IconComponent: Github,
      }, // Using Github as placeholder
    ];

    mockUseOAuthProviders.mockReturnValue({
      providers: mockProviders,
      loading: false,
      error: null,
    });

    render(<LoginPage />);

    expect(
      screen.getByRole("button", { name: /continue with github/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue with gitlab/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue with google/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: /continue with microsoft/i }),
    ).toBeInTheDocument();
  });
});
