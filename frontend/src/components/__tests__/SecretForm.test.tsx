import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SecretForm } from '../SecretForm';

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockAuthenticatedJson = vi.fn();

vi.mock('../../utils/authenticatedApi', () => ({
  authenticatedJson: (...args: unknown[]) => mockAuthenticatedJson(...args),
}));

vi.mock('../../utils/api', () => ({ default: 'http://localhost:8000' }));

vi.mock('../../utils/encryptSecretValue', () => ({
  encryptSecretValue: vi.fn().mockResolvedValue('ZW5jcnlwdGVkLXZhbHVl'),
}));

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('SecretForm', () => {
  const mockOnCreated = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    mockAuthenticatedJson.mockResolvedValue({
      keyId: 'key-1',
      publicKey: 'dGVzdC1wdWJsaWMta2V5',
      algorithm: 'libsodium-sealed-box',
    });
  });

  function renderForm(props: Partial<React.ComponentProps<typeof SecretForm>> = {}) {
    return render(
      <SecretForm
        scopeType="workspace"
        scopeId="ws-1"
        onCreated={mockOnCreated}
        {...props}
      />,
    );
  }

  it('renders secret name and value fields', () => {
    renderForm();
    expect(screen.getByText('Secret name')).toBeInTheDocument();
    expect(screen.getByText('Secret value')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('API_TOKEN')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('Enter secret value')).toBeInTheDocument();
  });

  it('renders "Add secret" button in create mode', () => {
    renderForm();
    expect(screen.getByText('Add secret')).toBeInTheDocument();
  });

  it('renders "Update secret" button in update mode', () => {
    renderForm({ existingSecretId: 'secret-1' });
    expect(screen.getByText('Update secret')).toBeInTheDocument();
  });

  it('shows validation error when name is empty', async () => {
    const user = userEvent.setup();
    renderForm();

    await user.click(screen.getByText('Add secret'));

    await waitFor(() => {
      expect(screen.getByText('Secret name is required')).toBeInTheDocument();
    });
  });

  it('shows validation error when name has invalid characters', async () => {
    const user = userEvent.setup();
    renderForm();

    const nameInput = screen.getByPlaceholderText('API_TOKEN');
    await user.type(nameInput, 'invalid-name');

    const valueInput = screen.getByPlaceholderText('Enter secret value');
    await user.type(valueInput, 'some-value');

    await user.click(screen.getByText('Add secret'));

    await waitFor(() => {
      expect(screen.getByText(/cannot contain/i)).toBeInTheDocument();
    });
  });

  it('shows validation error when value is empty', async () => {
    const user = userEvent.setup();
    renderForm();

    const nameInput = screen.getByPlaceholderText('API_TOKEN');
    await user.type(nameInput, 'MY_SECRET');

    await user.click(screen.getByText('Add secret'));

    await waitFor(() => {
      expect(screen.getByText('Secret value is required')).toBeInTheDocument();
    });
  });

  it('fetches public key, encrypts, and POSTs ciphertext on valid submit', async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson
      .mockResolvedValueOnce({
        keyId: 'key-1',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        algorithm: 'libsodium-sealed-box',
      }) // public key
      .mockResolvedValueOnce({ secretId: 'sec-1' }); // create secret

    renderForm();

    await user.type(screen.getByPlaceholderText('API_TOKEN'), 'MY_SECRET');
    await user.type(screen.getByPlaceholderText('Enter secret value'), 'super-secret-value');
    await user.click(screen.getByText('Add secret'));

    await waitFor(() => {
      expect(mockAuthenticatedJson).toHaveBeenCalledTimes(2);
      expect(mockOnCreated).toHaveBeenCalled();
    });
  });

  it('CRITICAL: secret value is NOT in DOM after successful save', async () => {
    const user = userEvent.setup();
    const secretPlaintext = 'ultra-secret-value-xyz-789';

    mockAuthenticatedJson
      .mockResolvedValueOnce({
        keyId: 'key-1',
        publicKey: 'dGVzdC1wdWJsaWMta2V5',
        algorithm: 'libsodium-sealed-box',
      })
      .mockResolvedValueOnce({ secretId: 'sec-1' });

    renderForm();

    await user.type(screen.getByPlaceholderText('API_TOKEN'), 'MY_SECRET');
    await user.type(screen.getByPlaceholderText('Enter secret value'), secretPlaintext);
    await user.click(screen.getByText('Add secret'));

    await waitFor(() => {
      expect(mockOnCreated).toHaveBeenCalled();
    });

    // The plaintext must NOT appear anywhere in the DOM
    expect(document.body.innerHTML).not.toContain(secretPlaintext);

    // The password input value should be cleared
    const valueInput = screen.getByPlaceholderText('Enter secret value') as HTMLInputElement;
    expect(valueInput.value).toBe('');
  });

  it('shows error message when API call fails', async () => {
    const user = userEvent.setup();
    mockAuthenticatedJson.mockRejectedValueOnce(new Error('Network error'));

    renderForm();

    await user.type(screen.getByPlaceholderText('API_TOKEN'), 'MY_SECRET');
    await user.type(screen.getByPlaceholderText('Enter secret value'), 'some-value');
    await user.click(screen.getByText('Add secret'));

    await waitFor(() => {
      expect(screen.getByText(/Network error/)).toBeInTheDocument();
    });
  });

  it('disables inputs while submitting', async () => {
    const user = userEvent.setup();
    // Make the API call hang
    mockAuthenticatedJson.mockReturnValue(new Promise(() => {}));

    renderForm();

    await user.type(screen.getByPlaceholderText('API_TOKEN'), 'MY_SECRET');
    await user.type(screen.getByPlaceholderText('Enter secret value'), 'some-value');
    await user.click(screen.getByText('Add secret'));

    await waitFor(() => {
      expect(screen.getByPlaceholderText('API_TOKEN')).toBeDisabled();
      expect(screen.getByPlaceholderText('Enter secret value')).toBeDisabled();
    });
  });
});
