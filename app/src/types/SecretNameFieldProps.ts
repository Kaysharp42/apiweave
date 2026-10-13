export interface SecretNameFieldProps {
  label: string;
  hint: string;
  error: string;
  reference: string | undefined;
  onChange: (reference: string) => void;
  placeholder: string;
}
