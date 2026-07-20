export interface FormFieldProps {
  label: string;
  hint?: string;
  error?: string;
  required?: boolean;
  children?: React.ReactNode;
  className?: string;
}
