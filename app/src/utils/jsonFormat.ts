function isBeautified(json: string): boolean {
  const lines = json.split("\n");
  if (lines.length <= 1) return false;
  const indentedLines = lines.filter(
    (line) => line.startsWith("  ") || line.startsWith("\t"),
  );
  return indentedLines.length > lines.length * 0.3;
}

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

export function tryMinifyJson(input: string): {
  success: boolean;
  result: string;
} {
  const trimmed = input.trim();
  if (!trimmed) return { success: false, result: input };

  try {
    const parsed = JSON.parse(trimmed);
    return { success: true, result: JSON.stringify(parsed) };
  } catch {
    return { success: false, result: input };
  }
}

export function formatOrMinifyJson(input: string): {
  success: boolean;
  result: string;
  action: "format" | "minify";
} {
  const trimmed = input.trim();
  if (!trimmed) return { success: false, result: input, action: "format" };

  try {
    const parsed = JSON.parse(trimmed);
    const alreadyBeautified = isBeautified(trimmed);
    if (alreadyBeautified) {
      return {
        success: true,
        result: JSON.stringify(parsed),
        action: "minify",
      };
    }
    return {
      success: true,
      result: JSON.stringify(parsed, null, 2),
      action: "format",
    };
  } catch {
    return { success: false, result: input, action: "format" };
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
