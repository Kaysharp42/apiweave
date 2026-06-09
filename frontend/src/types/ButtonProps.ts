import type { ButtonHTMLAttributes, ReactNode } from 'react';
import type { ButtonVariant } from './ButtonVariant';
import type { ButtonIntent } from './ButtonIntent';
import type { ButtonSize } from './ButtonSize';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  intent?: ButtonIntent;
  size?: ButtonSize;
  loading?: boolean;
  disabled?: boolean;
  fullWidth?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}
