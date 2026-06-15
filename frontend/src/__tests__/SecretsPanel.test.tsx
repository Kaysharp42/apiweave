import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SecretsPanel from '../components/SecretsPanel';
import type { Environment } from '../types';

vi.mock('../hooks/useSecretValues', () => ({
  deleteSecret: vi.fn().mockResolvedValue(undefined),
  fetchSecretPublicKey: vi.fn().mockResolvedValue({
    keyId: 'test-key-id',
    publicKey: 'dGVzdC1wdWJsaWMta2V5',
    algorithm: 'libsodium-sealed-box' as const,
  }),
  postEncryptedSecret: vi.fn().mockResolvedValue(undefined),
  useSecretValues: vi.fn(() => ({
    setSecretValue: vi.fn().mockResolvedValue(undefined),
    removeSecretValue: vi.fn().mockResolvedValue(undefined),
    getPublicKey: vi.fn().mockResolvedValue({
      keyId: 'test-key-id',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      algorithm: 'libsodium-sealed-box' as const,
    }),
  })),
}));

vi.mock('../utils/encryptSecretValue', () => ({
  encryptSecretValue: vi.fn().mockResolvedValue('ZW5jcnlwdGVkLXZhbHVl'),
}));

const makeEnv = (secrets?: Record<string, string>): Environment => ({
  id: 'env-1',
  environmentId: 'env-1',
  name: 'Test Environment',
  variables: [],
  createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z',
  secrets: secrets ?? {},
});

describe('SecretsPanel', () => {
  const onClose = vi.fn();
  const onSecretsChange = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('renders empty state when no secret keys exist', () => {
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv()}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('No secrets configured')).toBeInTheDocument();
    expect(
      screen.getByText(/Add secret keys in Environment Manager/),
    ).toBeInTheDocument();
  });

  it('shows secret keys with Set value buttons', () => {
    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv({ API_KEY: '', DB_PASSWORD: '' })}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    expect(screen.getByText('API_KEY')).toBeInTheDocument();
    expect(screen.getByText('DB_PASSWORD')).toBeInTheDocument();

    const setValueButtons = screen.getAllByText('Set value');
    expect(setValueButtons).toHaveLength(2);
  });

  it('opens SecretValueEditor modal when Set value is clicked', async () => {
    const user = userEvent.setup();

    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv({ API_KEY: '' })}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    const setValueBtn = screen.getByText('Set value');
    await user.click(setValueBtn);

    await waitFor(() => {
      expect(screen.getByText(/Set value: API_KEY/)).toBeInTheDocument();
    });

    expect(
      screen.getByPlaceholderText(/Enter value for API_KEY/),
    ).toBeInTheDocument();
  });

  it('does not leak plaintext values in DOM after editor closes', async () => {
    const user = userEvent.setup();
    const secretPlaintext = 'super-secret-value-xyz-789';

    render(
      <SecretsPanel
        isOpen={true}
        environment={makeEnv({ API_KEY: '' })}
        onSecretsChange={onSecretsChange}
        onClose={onClose}
      />,
    );

    await user.click(screen.getByText('Set value'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText(/Enter value for API_KEY/)).toBeInTheDocument();
    });

    const input = screen.getByPlaceholderText(/Enter value for API_KEY/);
    await user.type(input, secretPlaintext);

    const cancelBtn = screen.getByText('Cancel');
    await user.click(cancelBtn);

    await waitFor(() => {
      expect(screen.queryByText(/Set value: API_KEY/)).not.toBeInTheDocument();
    });

    expect(document.body.innerHTML).not.toContain(secretPlaintext);
  });
});
