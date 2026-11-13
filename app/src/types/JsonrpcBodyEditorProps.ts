import type { JsonrpcBody } from "@shared/types/JsonrpcBody";

export interface JsonrpcBodyEditorProps {
  readonly jsonrpc: JsonrpcBody | undefined;
  readonly isDarkMode: boolean;
  readonly allowRpcError: boolean;
  readonly onChange: (jsonrpc: JsonrpcBody) => void;
  readonly onAllowRpcErrorChange: (allow: boolean) => void;
}
