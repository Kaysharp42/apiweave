import type { HttpScriptsConfig } from "@shared/types/HttpScriptsConfig";

export interface HttpScriptsEditorProps {
  readonly scripts: HttpScriptsConfig | undefined;
  readonly isDarkMode: boolean;
  readonly onChange: (scripts: HttpScriptsConfig) => void;
}
