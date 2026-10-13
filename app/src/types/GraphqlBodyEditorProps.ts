import type { GraphqlBody } from "@shared/types/GraphqlBody";

export interface GraphqlBodyEditorProps {
  readonly graphql: GraphqlBody | undefined;
  readonly isDarkMode: boolean;
  readonly onChange: (graphql: GraphqlBody) => void;
}
