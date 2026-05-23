import type { ButtonHTMLAttributes, ReactNode } from 'react';

export interface IconSwitchProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, 'onChange'> {
  checked: boolean;
  onCheckedChange: (checked: boolean) => void;
  checkedIcon: ReactNode;
  uncheckedIcon: ReactNode;
  checkedLabel: string;
  uncheckedLabel: string;
  intent?: 'primary' | 'success';
}
