import type { SoapBody } from "@shared/types/SoapBody";

export interface SoapBodyEditorProps {
  readonly soap: SoapBody | undefined;
  readonly isDarkMode: boolean;
  readonly onChange: (soap: SoapBody) => void;
}
