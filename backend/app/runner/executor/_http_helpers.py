"""Mixin: HTTP helper methods for WorkflowExecutor (auth, file uploads, extractors)."""

import base64
import mimetypes
from pathlib import Path
from typing import Any
from urllib.parse import urlencode

import aiofiles


class _HttpHelpersMixin:
    """Auth, file upload, and variable extraction helpers for HTTP requests."""

    def _apply_auth_to_request(
        self,
        config: dict[str, Any],
        headers: dict[str, str],
        url: str,
    ) -> tuple[dict[str, str], str]:
        """Apply auth configuration to headers and URL.

        Returns ``(updated_headers, updated_url)``. Auth-applied headers do
        NOT override headers explicitly set in the config — config headers
        win on key collision.

        Supported ``auth.type`` values:
        - ``none`` / missing → no changes.
        - ``bearer`` → ``Authorization: Bearer <token>``.
        - ``basic`` → ``Authorization: Basic <base64(user:pass)>``.
        - ``apiKey`` → header or query placement based on ``addTo``.

        Unknown ``auth.type`` values are logged as a warning and treated as
        ``none`` (no exception raised).
        """
        auth = config.get("auth")
        if not auth or not isinstance(auth, dict):
            return headers, url

        auth_type = str(auth.get("type", "none") or "none").strip().lower()

        if auth_type == "none" or auth_type == "":
            return headers, url

        # Build a lowercase lookup of existing headers so config headers win.
        existing_lower = {k.lower(): k for k in headers.keys()}

        def set_header_if_absent(name: str, value: str) -> None:
            if name.lower() not in existing_lower:
                headers[name] = value

        if auth_type == "bearer":
            bearer_cfg = auth.get("bearer") or {}
            token = str(bearer_cfg.get("token", ""))
            token = self._substitute_variables(token)
            if token:
                set_header_if_absent("Authorization", f"Bearer {token}")
            return headers, url

        if auth_type == "basic":
            basic_cfg = auth.get("basic") or {}
            username = self._substitute_variables(str(basic_cfg.get("username", "")))
            password = self._substitute_variables(str(basic_cfg.get("password", "")))
            credentials = f"{username}:{password}"
            encoded = base64.b64encode(credentials.encode("utf-8")).decode("ascii")
            set_header_if_absent("Authorization", f"Basic {encoded}")
            return headers, url

        if auth_type == "apikey":
            api_key_cfg = auth.get("apiKey") or {}
            key_name = str(api_key_cfg.get("key", "")).strip()
            key_value = self._substitute_variables(str(api_key_cfg.get("value", "")))
            add_to = str(api_key_cfg.get("addTo", "header") or "header").strip().lower()

            if not key_name:
                return headers, url

            if add_to == "query":
                if key_value:
                    separator = "&" if "?" in url else "?"
                    url = f"{url}{separator}{urlencode({key_name: key_value})}"
            else:
                # Default to header placement for any unrecognized addTo value.
                if key_value:
                    set_header_if_absent(key_name, key_value)
            return headers, url

        # Unknown auth type — warn and treat as none.
        self.logger.warning("Unknown auth.type '%s' — treating as 'none'", auth_type)
        return headers, url

    def _extract_variables(self, extractors: dict[str, str], response: dict):
        """Extract variables from HTTP response using JSONPath-like syntax"""
        for var_name, var_path in extractors.items():
            try:
                # Navigate the response using dot notation
                # e.g., "body.data[0].city" -> response['body']['data'][0]['city']
                value = self._get_nested_value(response, var_path)

                if value is not None:
                    self.workflow_variables[var_name] = value
                    self.logger.info(f"✅ Extracted variable: {var_name} = {value}")
                else:
                    self.logger.error(
                        f"⚠️  Extracted variable {var_name} is None from path: {var_path}"
                    )
            except Exception as e:
                self.logger.error(
                    f"❌ Error extracting variable {var_name} from {var_path}: {str(e)}"
                )

    async def _get_file_content(self, file_ref: dict[str, str]) -> tuple[bytes, str, str]:
        """
        Get file content based on reference type and return (bytes, filename, mime_type)

        Supports three file reference types:
        1. base64: Embedded base64 encoded file
        2. path: File path on the server
        3. variable: Workflow variable containing base64 or path

        Returns: (file_bytes, filename, mime_type)
        """
        ref_type = file_ref.get("type", "")
        value = file_ref.get("value", "")
        field_name = file_ref.get("fieldName", "file")
        mime_type = file_ref.get("mimeType", "application/octet-stream")

        self.logger.debug(f"Resolving file upload: type={ref_type}, field={field_name}")

        # Lazy import to avoid circular dependency (executor ↔ services.__init__ ↔ run_service)
        from app.services.upload_sandbox import UploadSandboxError, resolve_upload_path

        try:
            # Type 1: Base64 encoded file
            if ref_type == "base64":
                # Handle data:image/png;base64,iVBORw0K... format
                if value.startswith("data:"):
                    parts = value.split(",", 1)
                    if len(parts) == 2:
                        value = parts[1]
                        # Extract MIME type from data URI if available
                        mime_match = parts[0].replace("data:", "").split(";", 1)[0].strip()
                        if mime_match:
                            mime_type = mime_match

                file_bytes = base64.b64decode(value)
                self.logger.info(
                    f"✅ Resolved base64 file: {field_name} ({len(file_bytes)} bytes, MIME: {mime_type})"
                )
                return file_bytes, field_name, mime_type

            # Type 2: File path reference
            elif ref_type == "path":
                # Substitute variables in path
                resolved_path = self._substitute_variables(value)

                # Validate path is within UPLOADS_BASE_DIR sandbox
                try:
                    path_obj = resolve_upload_path(resolved_path, must_exist=True)
                except UploadSandboxError as exc:
                    self.logger.error(f"Upload sandbox rejected file path: {resolved_path} ({exc})")
                    raise Exception(f"File access denied: {exc}") from exc

                # Read file asynchronously
                async with aiofiles.open(path_obj, "rb") as f:
                    file_bytes = await f.read()

                # Defense-in-depth: 50MB size limit (also enforced by sandbox)
                file_size_mb = len(file_bytes) / (1024 * 1024)
                if file_size_mb > 50:
                    raise Exception(f"File too large: {file_size_mb:.1f}MB (max 50MB)")

                self.logger.info(
                    f"✅ Resolved file path: {resolved_path} ({len(file_bytes)} bytes, MIME: {mime_type})"
                )
                return file_bytes, field_name, mime_type

            # Type 3: Variable reference
            elif ref_type == "variable":
                # Resolve variable (could contain base64 or path)
                resolved_value = self._substitute_variables(value)

                if not resolved_value:
                    raise Exception(f"Variable reference resolved to empty: {value}")

                # Check if it's a base64 data URI
                if resolved_value.startswith("data:"):
                    # Treat as base64
                    parts = resolved_value.split(",", 1)
                    if len(parts) == 2:
                        base64_data = parts[1]
                        mime_match = parts[0].replace("data:", "").split(";", 1)[0].strip()
                        if mime_match:
                            mime_type = mime_match
                        file_bytes = base64.b64decode(base64_data)
                        self.logger.info(
                            f"✅ Resolved variable as base64: {value} ({len(file_bytes)} bytes)"
                        )
                        return file_bytes, field_name, mime_type

                # Check if it's a file path
                elif (
                    resolved_value.startswith("/")
                    or resolved_value.startswith("\\")
                    or ":" in resolved_value
                ):
                    # Validate against upload sandbox
                    try:
                        path_obj = resolve_upload_path(resolved_value, must_exist=True)
                    except UploadSandboxError as exc:
                        self.logger.error(
                            f"Upload sandbox rejected variable file path: {resolved_value} ({exc})"
                        )
                        raise Exception(f"File access denied: {exc}") from exc

                    async with aiofiles.open(path_obj, "rb") as f:
                        file_bytes = await f.read()

                    # Defense-in-depth: 50MB size limit (also enforced by sandbox)
                    file_size_mb = len(file_bytes) / (1024 * 1024)
                    if file_size_mb > 50:
                        raise Exception(f"File too large: {file_size_mb:.1f}MB (max 50MB)")

                    self.logger.info(
                        f"✅ Resolved variable as file path: {resolved_value} ({len(file_bytes)} bytes)"
                    )
                    return file_bytes, field_name, mime_type

                # Assume it's raw base64
                else:
                    file_bytes = base64.b64decode(resolved_value)
                    self.logger.info(
                        f"✅ Resolved variable as raw base64: {value} ({len(file_bytes)} bytes)"
                    )
                    return file_bytes, field_name, mime_type

            else:
                raise Exception(f"Unknown file reference type: {ref_type}")

        except Exception as e:
            error_msg = f"Failed to resolve file upload: {str(e)}"
            self.logger.error(error_msg)
            raise Exception(error_msg)

    def _build_upload_filename(
        self, file_ref: dict[str, str], field_name: str, mime_type: str
    ) -> str:
        """Build upload filename and infer extension from MIME type when missing."""
        raw_name = (file_ref.get("name") or "").strip()
        candidate = raw_name or field_name or "upload"

        # Keep only basename to avoid directory leakage in multipart filename.
        file_name = Path(candidate).name
        if Path(file_name).suffix:
            return file_name

        clean_mime = (mime_type or "").split(";", 1)[0].strip().lower()
        if clean_mime == "application/pdf":
            return f"{file_name}.pdf"

        inferred_ext = mimetypes.guess_extension(clean_mime) if clean_mime else None
        if inferred_ext:
            return f"{file_name}{inferred_ext}"

        return file_name
