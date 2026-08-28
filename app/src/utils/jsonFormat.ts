export function tryFormatJson(input: string): {
  success: boolean;
  result: string;
} {
  const trimmed = input.trim();
  if (!trimmed) return { success: false, result: input };

  try {
    const parsed = JSON.parse(trimmed);
    return { success: true, result: JSON.stringify(parsed, null, 2) };
  } catch {
    return { success: false, result: input };
  }
}

export function isValidJson(input: string): boolean {
  try {
    JSON.parse(input.trim());
    return true;
  } catch {
    return false;
  }
}
