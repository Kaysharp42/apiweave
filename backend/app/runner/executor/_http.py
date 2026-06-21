"""Mixin: HTTP request execution for WorkflowExecutor."""

import base64
import json
import time
from typing import Any
from urllib.parse import urlencode

import aiohttp


class _HttpMixin:
    """HTTP request execution method."""

    async def _execute_http_request(self, node: dict) -> dict[str, Any]:
        """Execute HTTP request node"""

        from app.services.safe_http import SafeUrlError, safe_request, validate_url

        config = node.get("config", {})
        method = config.get("method", "GET")
        url = config.get("url", "")
        headers_field = config.get("headers", "")
        body = config.get("body", "")
        body_type = config.get("bodyType", None)
        timeout = config.get("timeout", 30)
        query_params_field = config.get("queryParams", "")
        path_variables_field = config.get("pathVariables", "")
        cookies_field = config.get("cookies", "")
        follow_redirects = config.get("followRedirects", True)
        ssl_verify = config.get("sslVerify", True)

        if not url:
            raise Exception("URL is required for HTTP request")

        # Substitute variables in URL
        url = self._substitute_variables(url, allow_secrets=False)

        # Handle path variables (e.g., /users/:userId -> /users/123)
        path_variables = self._normalize_key_value_field(path_variables_field, allow_secrets=False)
        for var_name, var_value in path_variables.items():
            url = url.replace(f":{var_name}", var_value)

        # Handle query parameters
        query_params = self._normalize_key_value_field(query_params_field, allow_secrets=False)
        if query_params:
            separator = "&" if "?" in url else "?"
            url = f"{url}{separator}{urlencode(query_params)}"

        # Validate URL against SSRF policy before making the request
        try:
            validate_url(url)
        except SafeUrlError as exc:
            self.logger.warning(f"Blocked unsafe outbound URL: {url} ({exc})")
            return {
                "status": "error",
                "error": f"SSRF blocked: {exc}",
                "method": method,
                "url": url,
                "duration": 0,
            }

        # Parse headers (accepts legacy string OR new array format)
        headers = self._normalize_key_value_field(headers_field)

        # Parse cookies (accepts legacy string OR new array format) and add to headers
        cookies = self._normalize_key_value_field(cookies_field)
        if cookies:
            cookie_header = "; ".join([f"{k}={v}" for k, v in cookies.items()])
            headers["Cookie"] = cookie_header

        # Apply auth config (bearer/basic/apiKey). Config headers win on collision.
        headers, url = self._apply_auth_to_request(config, headers, url)

        # Substitute variables in body
        if body:
            body = self._substitute_variables(body)

            # NEW: Warn if secrets are used in request body
            if self.secrets:
                for secret_key, secret_value in self.secrets.items():
                    if secret_value and secret_value in body:
                        self.logger.warning(
                            f"⚠️ Secret '{secret_key}' is used in request body - this data may be logged or cached"
                        )

        # Start timing
        start_time = time.time()

        # Handle file uploads
        file_uploads = config.get("fileUploads", [])
        has_files = len(file_uploads) > 0

        if has_files:
            # Let aiohttp generate multipart Content-Type (with boundary).
            # If users keep a JSON Content-Type header, many APIs reject the request
            # as "not multipart" before controller logic runs.
            for header_name in list(headers.keys()):
                if header_name.lower() in {"content-type", "content-length"}:
                    removed_value = headers.pop(header_name)
                    self.logger.warning(
                        f"Removed header for multipart upload: {header_name}={removed_value}"
                    )

        try:
            # Prepare request data
            data: Any = None
            json_payload: Any = None

            def set_content_type(content_type: str) -> None:
                for header_name in list(headers.keys()):
                    if header_name.lower() == "content-type":
                        headers[header_name] = content_type
                        return
                headers["Content-Type"] = content_type

            def get_content_type() -> str:
                for header_name, header_value in headers.items():
                    if header_name.lower() == "content-type":
                        return str(header_value).lower()
                return ""

            def remove_content_headers() -> None:
                for header_name in list(headers.keys()):
                    if header_name.lower() in {"content-type", "content-length"}:
                        headers.pop(header_name)

            def active_entries(config_key: str) -> list[dict[str, Any]]:
                entries = config.get(config_key, [])
                if not isinstance(entries, list):
                    return []
                return [
                    entry
                    for entry in entries
                    if isinstance(entry, dict) and entry.get("active", True)
                ]

            def decode_base64_payload(payload: str) -> bytes:
                _, separator, encoded_payload = payload.partition(",")
                return base64.b64decode(encoded_payload if separator else payload)

            normalized_body_type = str(body_type).strip().lower() if body_type is not None else None
            if has_files:
                # Use multipart/form-data for file uploads
                form_data = aiohttp.FormData()

                # Add regular form fields from body if it's JSON
                if body:
                    try:
                        body_dict = json.loads(body)
                        if isinstance(body_dict, dict):
                            for key, value in body_dict.items():
                                form_data.add_field(key, str(value))
                    except:
                        # If body is not JSON, use as single field
                        form_data.add_field("data", body)

                # Add files
                for file_ref in file_uploads:
                    try:
                        file_bytes, field_name, mime_type = await self._get_file_content(file_ref)
                        upload_filename = self._build_upload_filename(
                            file_ref, field_name, mime_type
                        )
                        form_data.add_field(
                            field_name, file_bytes, filename=upload_filename, content_type=mime_type
                        )
                        self.logger.info(
                            f"✅ Added file to form: {field_name} (filename: {upload_filename}, MIME: {mime_type})"
                        )
                    except Exception as e:
                        self.logger.error(f"❌ Failed to add file: {str(e)}")
                        raise

                data = form_data
            else:
                # Regular request without files
                if method != "GET":
                    if normalized_body_type == "json" and body:
                        set_content_type("application/json")
                        json_payload = json.loads(body)
                    elif normalized_body_type == "raw" and body:
                        if not get_content_type():
                            headers["Content-Type"] = "text/plain"
                        data = body
                    elif normalized_body_type == "form-data":
                        form_data = aiohttp.FormData()
                        for entry in active_entries("formDataEntries"):
                            key = str(entry.get("key", ""))
                            if not key:
                                continue

                            if entry.get("type") == "file":
                                file_data = str(entry.get("fileData", ""))
                                file_bytes = decode_base64_payload(file_data) if file_data else b""
                                form_data.add_field(
                                    key,
                                    file_bytes,
                                    filename=str(entry.get("fileName") or key),
                                    content_type=str(
                                        entry.get("contentType") or "application/octet-stream"
                                    ),
                                )
                            else:
                                value = self._substitute_variables(str(entry.get("value", "")))
                                form_data.add_field(key, value, content_type="text/plain")

                        remove_content_headers()
                        data = form_data
                    elif normalized_body_type == "x-www-form-urlencoded":
                        form_values: list[tuple[str, str]] = []
                        for entry in active_entries("urlEncodedEntries"):
                            key = str(entry.get("key", ""))
                            if key:
                                form_values.append(
                                    (key, self._substitute_variables(str(entry.get("value", ""))))
                                )

                        set_content_type("application/x-www-form-urlencoded")
                        data = urlencode(form_values)
                    elif normalized_body_type == "binary" and body:
                        set_content_type("application/octet-stream")
                        data = decode_base64_payload(body)
                    elif normalized_body_type in {"xml", "html"} and body:
                        set_content_type(
                            "application/xml" if normalized_body_type == "xml" else "text/html"
                        )
                        data = body
                    elif body:
                        content_type_value = get_content_type()

                        body_stripped = body.strip()
                        looks_like_json = body_stripped.startswith("{") or body_stripped.startswith(
                            "["
                        )

                        if "application/json" in content_type_value:
                            try:
                                json_payload = json.loads(body)
                            except Exception:
                                # Keep raw body if JSON parsing fails; server will validate.
                                data = body
                        elif not content_type_value and looks_like_json:
                            headers["Content-Type"] = "application/json"
                            try:
                                json_payload = json.loads(body)
                                self.logger.info(
                                    "Auto-detected JSON body and set Content-Type=application/json"
                                )
                            except Exception:
                                self.logger.warning(
                                    "JSON-like body detected but parsing failed; sending raw body with Content-Type=application/json"
                                )
                                data = body
                        else:
                            data = body

            response, session = await safe_request(
                method,
                url,
                timeout=float(timeout),
                headers=headers,
                data=data if method != "GET" else None,
                json=json_payload if method != "GET" else None,
                follow_redirects=bool(follow_redirects),
                ssl_verify=bool(ssl_verify),
            )
            try:
                response_text = await response.text()
                status_code = response.status

                # End timing
                end_time = time.time()
                duration_ms = int(
                    round((end_time - start_time) * 1000)
                )  # Convert to int milliseconds

                response_size_bytes = len(response_text.encode("utf-8"))
                content_type = response.headers.get("Content-Type", "")
                content_type_lower = content_type.lower()
                if "application/json" in content_type_lower:
                    body_format = "json"
                elif "application/xml" in content_type_lower or "text/xml" in content_type_lower:
                    body_format = "xml"
                elif "text/html" in content_type_lower:
                    body_format = "html"
                elif content_type_lower.startswith("image/"):
                    body_format = "image"
                elif content_type_lower.startswith("text/"):
                    body_format = "text"
                else:
                    body_format = "binary"

                # Try to parse response as JSON
                try:
                    response_body = json.loads(response_text)
                except:
                    response_body = response_text

                # Extract cookies from response
                response_cookies: list[dict[str, Any]] = []
                set_cookie_headers = response.headers.getall("Set-Cookie", [])
                for cookie_header in set_cookie_headers:
                    cookie_parts = [part.strip() for part in cookie_header.split(";")]
                    if not cookie_parts or "=" not in cookie_parts[0]:
                        continue

                    cookie_name, cookie_value = cookie_parts[0].split("=", 1)
                    attributes: dict[str, Any] = {}
                    for attribute in cookie_parts[1:]:
                        if not attribute:
                            continue
                        if "=" in attribute:
                            attribute_name, attribute_value = attribute.split("=", 1)
                            attributes[attribute_name.strip()] = attribute_value.strip()
                        else:
                            attributes[attribute.strip()] = True

                    response_cookies.append(
                        {
                            "name": cookie_name.strip(),
                            "value": cookie_value.strip(),
                            "attributes": attributes,
                        }
                    )

                # Determine status based on HTTP status code
                if status_code >= 200 and status_code < 300:
                    status = "success"
                elif status_code >= 300 and status_code < 400:
                    status = "redirect"
                elif status_code >= 400 and status_code < 500:
                    status = "client_error"
                elif status_code >= 500:
                    status = "server_error"
                else:
                    status = "unknown"

                # Structure response for easy variable access
                redirect_count = len(getattr(response, "history", []))
                result = {
                    "status": status,
                    "statusCode": status_code,
                    "headers": dict(response.headers),
                    "body": response_body,  # Parsed JSON or raw text
                    "cookies": response_cookies,
                    "duration": duration_ms,  # Request duration in milliseconds
                    "responseSizeBytes": response_size_bytes,
                    "contentType": content_type,
                    "bodyFormat": body_format,
                    "responseTimeMs": duration_ms,
                    "cookieCount": len(set_cookie_headers),
                    "redirectCount": redirect_count,
                    "method": method,
                    "url": url,
                }

                # Store in context with 'response' wrapper for easy access
                result["response"] = {
                    "body": response_body,
                    "headers": dict(response.headers),
                    "cookies": response_cookies,
                    "statusCode": status_code,
                }

                # Extract variables if configured
                extractors = config.get("extractors", {})
                if extractors:
                    self._extract_variables(extractors, result)

                return result
            finally:
                response.close()
                await session.close()
        except Exception as e:
            # Network error or other request failure
            # Return an error result that can be handled downstream
            error_msg = str(e)
            self.logger.error(f"HTTP request failed for {url}: {error_msg}")
            self.logger.error(f"❌ HTTP request error: {error_msg}")
            return {
                "status": "error",
                "error": error_msg,
                "method": method,
                "url": url,
                "duration": int(
                    round((time.time() - start_time) * 1000)
                ),  # Convert to int milliseconds
            }
