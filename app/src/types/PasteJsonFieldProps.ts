export interface PasteJsonFieldProps {
  id: string;
  label: string;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  rows?: number;
  className?: string;
}
