export interface SearchInputProps {
  value?: string;
  onChange: (value: string) => void;
  placeholder?: string;
  size?: 'xs' | 'sm' | 'md';
  className?: string;
  autoFocus?: boolean;
}
