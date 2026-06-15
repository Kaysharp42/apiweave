import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AccountSettingsPage from '../pages/AccountSettingsPage';
import type { User } from '../types';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockNavigate = vi.fn();

vi.mock('react-router-dom', async () => {
  const actual = await vi.importActual<typeof import('react-router-dom')>('react-router-dom');
  return {
    ...actual,
    useNavigate: () => mockNavigate,
  };
});

const mockLogout = vi.fn().mockResolvedValue(undefined);
const mockSignOut = vi.fn().mockResolvedValue(undefined);

vi.mock('../auth/useAuth', () => ({
  useAuth: () => ({
    user: currentUser,
    status: 'authenticated' as const,
    error: null,
    isLoading: false,
    isAuthenticated: true,
    isSetupComplete: true,
    login: vi.fn(),
    logout: mockLogout,
    refresh: vi.fn(),
    hasPermission: vi.fn(() => false),
  }),
}));

vi.mock('../hooks/useSignOut', () => ({
  useSignOut: () => ({
    signOut: mockSignOut,
    isSigningOut: false,
    error: null,
  }),
}));

// ---------------------------------------------------------------------------
// Test user factories
// ---------------------------------------------------------------------------

let currentUser: User | null = null;

function makeLocalUser(): User {
  return {
    userId: 'usr-local1',
    verified_email: 'admin@local.test',
    display_name: 'Local Admin',
    avatar_url: null,
    roles: ['admin'],
    permissions: [],
    oauth_accounts: [
      {
        provider: 'local',
        providerSubject: 'local-admin',
        linkedAt: '2026-01-01T00:00:00Z',
        emailVerified: true,
      },
    ],
    is_setup_complete: true,
    created_at: '2026-01-01T00:00:00Z',
  };
}

function makeGitHubUser(): User {
  return {
    userId: 'usr-gh1',
    verified_email: 'dev@github.test',
    display_name: 'GitHub Dev',
    avatar_url: null,
    roles: ['viewer'],
    permissions: [],
    oauth_accounts: [
      {
        provider: 'github',
        providerSubject: 'gh-12345',
        linkedAt: '2026-02-15T10:30:00Z',
        emailVerified: true,
      },
    ],
    is_setup_complete: true,
    created_at: '2026-02-15T10:30:00Z',
  };
}

function makeGoogleUser(): User {
  return {
    userId: 'usr-gg1',
    verified_email: 'user@google.test',
    display_name: 'Google User',
    avatar_url: null,
    roles: ['viewer'],
    permissions: [],
    oauth_accounts: [
      {
        provider: 'google',
        providerSubject: 'google-67890',
        linkedAt: '2026-03-01T08:00:00Z',
        emailVerified: true,
      },
    ],
    is_setup_complete: true,
    created_at: '2026-03-01T08:00:00Z',
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('AccountSettingsPage', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    currentUser = null;
  });

  it('renders "Sign-in method" heading', () => {
    currentUser = makeLocalUser();
    render(<AccountSettingsPage />);
    expect(screen.getByText('Sign-in method')).toBeInTheDocument();
  });

  describe('local user', () => {
    it('shows "Local account" label and change-password section', () => {
      currentUser = makeLocalUser();
      render(<AccountSettingsPage />);

      expect(screen.getByText('Local account')).toBeInTheDocument();
      expect(screen.getByText('admin@local.test')).toBeInTheDocument();
      expect(screen.getByText('Change password')).toBeInTheDocument();
    });

    it('does NOT show a sign-out button for local users', () => {
      currentUser = makeLocalUser();
      render(<AccountSettingsPage />);

      expect(
        screen.queryByText(/Sign out of/),
      ).not.toBeInTheDocument();
    });
  });

  describe('OAuth user (github)', () => {
    it('shows provider label "Continue with GitHub" and sign-out button', () => {
      currentUser = makeGitHubUser();
      render(<AccountSettingsPage />);

      expect(screen.getByText('Continue with GitHub')).toBeInTheDocument();
      expect(screen.getByText('dev@github.test')).toBeInTheDocument();
      expect(
        screen.getByText('Sign out of Continue with GitHub'),
      ).toBeInTheDocument();
    });

    it('does NOT show "Local account" or change-password form', () => {
      currentUser = makeGitHubUser();
      render(<AccountSettingsPage />);

      expect(screen.queryByText('Local account')).not.toBeInTheDocument();
      expect(screen.queryByText('Change password')).not.toBeInTheDocument();
    });
  });

  describe('OAuth user (google)', () => {
    it('shows provider label "Continue with Google"', () => {
      currentUser = makeGoogleUser();
      render(<AccountSettingsPage />);

      expect(screen.getByText('Continue with Google')).toBeInTheDocument();
      expect(screen.getByText('user@google.test')).toBeInTheDocument();
    });
  });

  describe('sign-out button', () => {
    it('calls signOut when clicked', async () => {
      const user = userEvent.setup();
      currentUser = makeGitHubUser();
      render(<AccountSettingsPage />);

      const signOutButton = screen.getByText('Sign out of Continue with GitHub');
      await user.click(signOutButton);

      expect(mockSignOut).toHaveBeenCalledTimes(1);
    });
  });
});
