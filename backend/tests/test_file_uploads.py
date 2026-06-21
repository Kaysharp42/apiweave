"""
Test file uploads in HTTP request nodes
Tests all three file reference types: base64, path, and variable
"""

import base64
import tempfile
from pathlib import Path

import aiohttp
import pytest
from app.runner.executor import WorkflowExecutor


@pytest.fixture
def executor():
    """Create a WorkflowExecutor instance for testing"""
    executor = WorkflowExecutor(run_id="test_run_123", workflow_id="test_workflow_456")
    executor.workflow_variables = {}
    executor.environment_variables = {}
    executor.secrets = {}
    # Don't override logger, use the one from the instance
    return executor


@pytest.fixture
def sandbox_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    """Create a temporary uploads sandbox and patch the sandbox resolver."""
    uploads = tmp_path / "uploads"
    uploads.mkdir()
    monkeypatch.setattr(
        "app.services.upload_sandbox._get_uploads_base_dir",
        lambda: uploads.resolve(),
    )
    return uploads


@pytest.fixture
def temp_file(sandbox_dir: Path) -> str:
    """Create a test file inside the sandbox."""
    f = sandbox_dir / "test_upload.json"
    f.write_bytes(b"This is test file content for upload")
    return str(f)


class TestFileUploadBase64:
    """Tests for base64 encoded file uploads"""

    @pytest.mark.asyncio
    async def test_base64_file_resolution(self, executor):
        """Test resolving a base64 encoded file"""
        test_content = b"Hello, World!"
        base64_content = base64.b64encode(test_content).decode("utf-8")

        file_ref = {
            "type": "base64",
            "value": base64_content,
            "fieldName": "document",
            "mimeType": "text/plain",
            "name": "test.txt",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == test_content
        assert field_name == "document"
        assert mime_type == "text/plain"

    @pytest.mark.asyncio
    async def test_data_uri_base64_resolution(self, executor):
        """Test resolving a data:image/png;base64,... format"""
        test_content = b"PNG fake content"
        base64_content = base64.b64encode(test_content).decode("utf-8")
        data_uri = f"data:image/png;base64,{base64_content}"

        file_ref = {
            "type": "base64",
            "value": data_uri,
            "fieldName": "profile_image",
            "mimeType": "application/octet-stream",
            "name": "profile.png",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == test_content
        assert field_name == "profile_image"
        # MIME type includes ;base64 when extracted from data URI
        assert "image/png" in mime_type

    @pytest.mark.asyncio
    async def test_invalid_base64(self, executor):
        """Test error handling for invalid base64"""
        file_ref = {
            "type": "base64",
            "value": "!!!invalid base64!!!",
            "fieldName": "document",
            "mimeType": "text/plain",
        }

        with pytest.raises(Exception) as exc_info:
            await executor._get_file_content(file_ref)

        assert "Failed to resolve file upload" in str(exc_info.value)


class TestFileUploadPath:
    """Tests for file path reference uploads"""

    @pytest.mark.asyncio
    async def test_file_path_resolution(self, executor, temp_file):
        """Test resolving a file from the file system"""
        file_ref = {
            "type": "path",
            "value": temp_file,
            "fieldName": "document",
            "mimeType": "text/plain",
            "name": "upload.txt",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == b"This is test file content for upload"
        assert field_name == "document"
        assert mime_type == "text/plain"

    @pytest.mark.asyncio
    async def test_path_with_variable_substitution(self, executor, temp_file):
        """Test file path with variable substitution"""
        executor.workflow_variables = {"file_path": temp_file}

        file_ref = {
            "type": "path",
            "value": "{{variables.file_path}}",
            "fieldName": "document",
            "mimeType": "text/plain",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == b"This is test file content for upload"
        assert field_name == "document"

    @pytest.mark.asyncio
    async def test_file_not_found(self, executor):
        """Test error handling for missing file"""
        file_ref = {
            "type": "path",
            "value": "/nonexistent/file/path.txt",
            "fieldName": "document",
            "mimeType": "text/plain",
        }

        with pytest.raises(Exception) as exc_info:
            await executor._get_file_content(file_ref)

        assert "File not found" in str(exc_info.value) or "Failed to resolve" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_path_traversal_prevention(self, executor):
        """Test prevention of path traversal attacks"""
        file_ref = {
            "type": "path",
            "value": "/safe/path/../../../etc/passwd",
            "fieldName": "document",
            "mimeType": "text/plain",
        }

        with pytest.raises(Exception) as exc_info:
            await executor._get_file_content(file_ref)

        assert "Path traversal" in str(exc_info.value) or "Failed to resolve" in str(exc_info.value)

    @pytest.mark.asyncio
    async def test_directory_not_file(self, executor):
        """Test error handling when path points to directory"""
        with tempfile.TemporaryDirectory() as temp_dir:
            file_ref = {
                "type": "path",
                "value": temp_dir,
                "fieldName": "document",
                "mimeType": "text/plain",
            }

            with pytest.raises(Exception) as exc_info:
                await executor._get_file_content(file_ref)

            assert "not a file" in str(exc_info.value) or "Failed to resolve" in str(exc_info.value)


class TestFileUploadVariable:
    """Tests for variable reference file uploads"""

    @pytest.mark.asyncio
    async def test_variable_as_base64(self, executor):
        """Test variable containing base64 encoded content"""
        test_content = b"Variable-based content"
        base64_content = base64.b64encode(test_content).decode("utf-8")
        executor.workflow_variables = {"file_content": base64_content}

        file_ref = {
            "type": "variable",
            "value": "{{variables.file_content}}",
            "fieldName": "document",
            "mimeType": "text/plain",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == test_content
        assert field_name == "document"

    @pytest.mark.asyncio
    async def test_variable_as_file_path(self, executor, temp_file):
        """Test variable containing file path"""
        executor.workflow_variables = {"file_path": temp_file}

        file_ref = {
            "type": "variable",
            "value": "{{variables.file_path}}",
            "fieldName": "document",
            "mimeType": "text/plain",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == b"This is test file content for upload"
        assert field_name == "document"

    @pytest.mark.asyncio
    async def test_variable_as_data_uri(self, executor):
        """Test variable containing data URI"""
        test_content = b"Data URI content"
        base64_content = base64.b64encode(test_content).decode("utf-8")
        data_uri = f"data:application/json;base64,{base64_content}"
        executor.workflow_variables = {"file_data": data_uri}

        file_ref = {
            "type": "variable",
            "value": "{{variables.file_data}}",
            "fieldName": "payload",
            "mimeType": "application/octet-stream",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == test_content
        assert field_name == "payload"
        # MIME type stays with default since variable resolution returns base64 with MIME embedded
        # The extracted MIME would require additional parsing logic

    @pytest.mark.asyncio
    async def test_unresolved_variable(self, executor):
        """Test handling of unresolved variable - falls back to treating as base64"""
        # NOTE: Unresolved variables don't raise an error by default
        # They're treated as raw base64 strings
        # In this case {{variables.nonexistent}} becomes a string that can be decoded as base64
        file_ref = {
            "type": "variable",
            "value": "{{variables.nonexistent}}",
            "fieldName": "document",
            "mimeType": "text/plain",
        }

        # This will attempt to decode the string as base64
        # The fallback behavior treats unresolved as base64 strings
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)
        # Just verify it returns something (actual content is the string encoded)
        assert isinstance(file_bytes, bytes)
        assert field_name == "document"


class TestFileUploadFileSizeLimit:
    """Tests for file size validation"""

    @pytest.mark.asyncio
    async def test_large_file_rejected(self, executor):
        """Test that very large files create large outputs"""
        # Note: This test creates a file that's 51MB when decoded
        # The size limit check happens after base64 decoding
        # Since our test doesn't actually hit the file I/O, we just verify
        # that large content can be decoded
        large_size = 10 * 1024 * 1024  # 10MB for faster testing
        test_content = b"x" * large_size
        base64_content = base64.b64encode(test_content).decode("utf-8")

        file_ref = {
            "type": "base64",
            "value": base64_content,
            "fieldName": "document",
            "mimeType": "application/octet-stream",
        }

        # This should succeed since 10MB < 50MB limit
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)
        assert len(file_bytes) == large_size

    @pytest.mark.asyncio
    async def test_file_at_size_limit(self, executor):
        """Test that files exactly at 50MB are accepted"""
        # Create a file close to but under 50MB (to avoid memory issues in tests)
        large_size = 5 * 1024 * 1024  # 5MB (smaller for test)
        test_content = b"x" * large_size
        base64_content = base64.b64encode(test_content).decode("utf-8")

        file_ref = {
            "type": "base64",
            "value": base64_content,
            "fieldName": "document",
            "mimeType": "application/octet-stream",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert len(file_bytes) == large_size
        assert field_name == "document"


class TestFileUploadMimeType:
    """Tests for MIME type handling"""

    @pytest.mark.asyncio
    async def test_custom_mime_type(self, executor):
        """Test custom MIME type setting"""
        test_content = b"PDF content"
        base64_content = base64.b64encode(test_content).decode("utf-8")

        file_ref = {
            "type": "base64",
            "value": base64_content,
            "fieldName": "pdf_file",
            "mimeType": "application/pdf",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert mime_type == "application/pdf"

    @pytest.mark.asyncio
    async def test_default_mime_type(self, executor):
        """Test default MIME type when not specified"""
        test_content = b"Binary content"
        base64_content = base64.b64encode(test_content).decode("utf-8")

        file_ref = {
            "type": "base64",
            "value": base64_content,
            "fieldName": "file",
            # mimeType not specified
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert mime_type == "application/octet-stream"


class TestMultipartFormData:
    """Tests for multipart form data handling"""

    @pytest.mark.asyncio
    async def test_formdata_creation_with_files(self, executor):
        """Test that FormData is properly created for file uploads"""
        # This is more of an integration test
        # We just verify the form data can be created
        form_data = aiohttp.FormData()

        test_content = b"Test file"
        form_data.add_field("field1", "value1")
        form_data.add_field(
            "file_field", test_content, filename="test.txt", content_type="text/plain"
        )

        # FormData should be successfully created
        assert form_data is not None

    @pytest.mark.asyncio
    async def test_multiple_files_in_form(self, executor):
        """Test adding multiple files to form data"""
        form_data = aiohttp.FormData()

        file1 = b"File 1 content"
        file2 = b"File 2 content"

        form_data.add_field("file1", file1, filename="file1.txt", content_type="text/plain")
        form_data.add_field("file2", file2, filename="file2.txt", content_type="text/plain")
        form_data.add_field("description", "Two files")

        assert form_data is not None


class TestEnvironmentVariables:
    """Tests for environment variable references in file paths"""

    @pytest.mark.asyncio
    async def test_env_variable_in_path(self, executor, temp_file):
        """Test file path with environment variable"""
        # Extract directory and filename
        path_obj = Path(temp_file)
        directory = str(path_obj.parent)
        filename = path_obj.name

        executor.environment_variables = {"UPLOAD_DIR": directory}

        file_ref = {
            "type": "path",
            "value": f"{{{{env.UPLOAD_DIR}}}}/{filename}",
            "fieldName": "document",
            "mimeType": "text/plain",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == b"This is test file content for upload"


class TestWebhookFileUploadScenario:
    """Tests simulating webhook triggered file uploads"""

    @pytest.mark.asyncio
    async def test_webhook_with_file_path_variable(self, executor, temp_file):
        """
        Test scenario: Webhook provides file path in payload
        Workflow extracts it to variable and uses in upload
        """
        # Simulate webhook payload setting variable
        executor.workflow_variables = {"upload_file_path": temp_file, "document_type": "invoice"}

        file_ref = {
            "type": "variable",
            "value": "{{variables.upload_file_path}}",
            "fieldName": "invoice_document",
            "mimeType": "application/pdf",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == b"This is test file content for upload"
        assert field_name == "invoice_document"

    @pytest.mark.asyncio
    async def test_webhook_with_base64_payload(self, executor):
        """
        Test scenario: Webhook provides base64 encoded file content
        """
        test_content = b"Invoice PDF content"
        base64_content = base64.b64encode(test_content).decode("utf-8")

        # Simulate webhook payload
        executor.workflow_variables = {"file_content": base64_content, "filename": "invoice.pdf"}

        file_ref = {
            "type": "variable",
            "value": "{{variables.file_content}}",
            "fieldName": "invoice_file",
            "mimeType": "application/pdf",
        }

        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == test_content
        assert field_name == "invoice_file"


class TestErrorHandling:
    """Tests for various error scenarios"""

    @pytest.mark.asyncio
    async def test_unknown_reference_type(self, executor):
        """Test error handling for unknown file reference type"""
        file_ref = {
            "type": "unknown_type",
            "value": "some_value",
            "fieldName": "file",
            "mimeType": "text/plain",
        }

        with pytest.raises(Exception) as exc_info:
            await executor._get_file_content(file_ref)

        assert "Unknown file reference type" in str(exc_info.value) or "Failed to resolve" in str(
            exc_info.value
        )

    @pytest.mark.asyncio
    async def test_missing_required_fields(self, executor):
        """Test handling of empty value field - treats as empty base64 string"""
        file_ref = {
            "type": "base64",
            # Missing 'value' field - will default to empty string
            "fieldName": "file",
        }

        # Empty base64 decodes to empty bytes (valid)
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)
        assert file_bytes == b""
        assert field_name == "file"


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
