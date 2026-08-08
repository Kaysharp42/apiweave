export interface ExtractorFormProps {
  onAdd: (variableName: string, responsePath: string) => void;
  /** Variable names already configured, used to warn about replacement. */
  existingNames?: readonly string[];
}
