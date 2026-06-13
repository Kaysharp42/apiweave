"""
Integration tests for file uploads in workflows
Tests end-to-end workflow execution with file attachments
"""

import base64
import json
from pathlib import Path

import pytest

from app.runner.executor import WorkflowExecutor


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
    f.write_text(json.dumps({"test": "data", "value": 123}))
    return str(f)


@pytest.fixture
def executor():
    """Create executor for testing"""
    executor = WorkflowExecutor(run_id="test_run", workflow_id="test_workflow")
    return executor


class TestFileUploadIntegration:
    """Integration tests for file upload workflows"""

    @pytest.mark.asyncio
    async def test_workflow_with_base64_file(self, executor):
        """Test workflow execution with base64 encoded file"""
        # Create a simple file content
        file_content = b"Hello, World! This is a test file."
        base64_content = base64.b64encode(file_content).decode("utf-8")

        # Set up node with file upload
        node_data = {
            "id": "http_1",
            "type": "http-request",
            "config": {
                "method": "POST",
                "url": "https://httpbin.org/post",
                "headers": "Content-Type=application/json",
                "body": '{"test": "data"}',
                "fileUploads": [
                    {
                        "name": "test_file",
                        "type": "base64",
                        "value": base64_content,
                        "fieldName": "file",
                        "mimeType": "text/plain",
                    }
                ],
            },
        }

        # Get file content
        file_ref = node_data["config"]["fileUploads"][0]
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == file_content
        assert field_name == "file"
        assert mime_type == "text/plain"

    @pytest.mark.asyncio
    async def test_workflow_with_file_path(self, executor, temp_file):
        """Test workflow with file path reference"""
        node_data = {
            "id": "http_1",
            "type": "http-request",
            "config": {
                "method": "POST",
                "url": "https://api.example.com/upload",
                "fileUploads": [
                    {
                        "name": "data_file",
                        "type": "path",
                        "value": temp_file,
                        "fieldName": "data",
                        "mimeType": "application/json",
                    }
                ],
            },
        }

        file_ref = node_data["config"]["fileUploads"][0]
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        content = json.loads(file_bytes.decode())
        assert content["test"] == "data"
        assert content["value"] == 123
        assert field_name == "data"

    @pytest.mark.asyncio
    async def test_workflow_with_variable_file(self, executor):
        """Test workflow with variable containing file reference"""
        # Set up variable with base64 content
        file_content = b"Variable file content"
        base64_content = base64.b64encode(file_content).decode("utf-8")
        executor.workflow_variables["uploadFile"] = base64_content

        node_data = {
            "id": "http_1",
            "type": "http-request",
            "config": {
                "fileUploads": [
                    {
                        "name": "var_file",
                        "type": "variable",
                        "value": "{{variables.uploadFile}}",
                        "fieldName": "file",
                        "mimeType": "text/plain",
                    }
                ]
            },
        }

        file_ref = node_data["config"]["fileUploads"][0]
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert file_bytes == file_content
        assert field_name == "file"

    @pytest.mark.asyncio
    async def test_multiple_files_in_request(self, executor, temp_file):
        """Test HTTP request with multiple file attachments"""
        file1_content = b"File 1 content"
        file1_base64 = base64.b64encode(file1_content).decode("utf-8")

        node_data = {
            "id": "http_1",
            "type": "http-request",
            "config": {
                "method": "POST",
                "url": "https://api.example.com/multi-upload",
                "fileUploads": [
                    {
                        "name": "file1",
                        "type": "base64",
                        "value": file1_base64,
                        "fieldName": "resume",
                        "mimeType": "application/pdf",
                    },
                    {
                        "name": "file2",
                        "type": "path",
                        "value": temp_file,
                        "fieldName": "data",
                        "mimeType": "application/json",
                    },
                ],
            },
        }

        # Process both files
        results = []
        for file_ref in node_data["config"]["fileUploads"]:
            file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)
            results.append((field_name, len(file_bytes)))

        assert len(results) == 2
        assert results[0][0] == "resume"  # First file field name
        assert results[1][0] == "data"  # Second file field name

    @pytest.mark.asyncio
    async def test_variable_substitution_in_file_path(self, executor, temp_file):
        """Test variable substitution within file paths"""
        # Set up variables for path construction
        path_dir = str(Path(temp_file).parent)
        filename = Path(temp_file).name

        executor.workflow_variables["uploadDir"] = path_dir
        executor.workflow_variables["dataFile"] = filename

        node_data = {
            "config": {
                "fileUploads": [
                    {
                        "name": "constructed_path",
                        "type": "path",
                        "value": "{{variables.uploadDir}}/{{variables.dataFile}}",
                        "fieldName": "file",
                        "mimeType": "application/json",
                    }
                ]
            }
        }

        file_ref = node_data["config"]["fileUploads"][0]
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        content = json.loads(file_bytes.decode())
        assert "test" in content
        assert field_name == "file"

    @pytest.mark.asyncio
    async def test_file_upload_with_environment_variables(self, executor, temp_file):
        """Test file path with environment variables"""
        path_dir = str(Path(temp_file).parent)
        filename = Path(temp_file).name

        executor.environment_variables["UPLOAD_DIR"] = path_dir
        executor.workflow_variables["filename"] = filename

        node_data = {
            "config": {
                "fileUploads": [
                    {
                        "name": "env_file",
                        "type": "path",
                        "value": "{{env.UPLOAD_DIR}}/{{variables.filename}}",
                        "fieldName": "file",
                        "mimeType": "application/json",
                    }
                ]
            }
        }

        file_ref = node_data["config"]["fileUploads"][0]
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        content = json.loads(file_bytes.decode())
        assert content["test"] == "data"


class TestWebhookFileUploadScenarios:
    """Test realistic webhook + file upload scenarios"""

    @pytest.mark.asyncio
    async def test_webhook_document_upload_flow(self, executor, temp_file):
        """
        Scenario: Webhook triggered with document path
        Workflow: Extract variable → Upload to API
        """
        # Simulate webhook payload extraction
        executor.workflow_variables["documentPath"] = temp_file
        executor.workflow_variables["userId"] = "user-123"

        node_config = {
            "fileUploads": [
                {
                    "name": "document",
                    "type": "variable",
                    "value": "{{variables.documentPath}}",
                    "fieldName": "document_file",
                    "mimeType": "application/json",
                }
            ]
        }

        file_ref = node_config["fileUploads"][0]
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        assert len(file_bytes) > 0
        assert field_name == "document_file"

    @pytest.mark.asyncio
    async def test_webhook_with_inline_file_content(self, executor):
        """
        Scenario: Webhook includes base64 encoded file
        Workflow: Extract and upload
        """
        # Webhook payload simulation
        file_content = b'{"invoice": "12345", "amount": 1000}'
        base64_content = base64.b64encode(file_content).decode("utf-8")

        executor.workflow_variables["invoiceData"] = base64_content
        executor.workflow_variables["invoiceId"] = "inv-12345"

        node_config = {
            "fileUploads": [
                {
                    "name": "invoice",
                    "type": "variable",
                    "value": "{{variables.invoiceData}}",
                    "fieldName": "invoice_file",
                    "mimeType": "application/json",
                }
            ]
        }

        file_ref = node_config["fileUploads"][0]
        file_bytes, field_name, mime_type = await executor._get_file_content(file_ref)

        content = json.loads(file_bytes.decode())
        assert content["invoice"] == "12345"
        assert content["amount"] == 1000


class TestFileUploadErrorScenarios:
    """Test error handling in file upload workflows"""

    @pytest.mark.asyncio
    async def test_missing_file_path(self, executor):
        """Test handling of non-existent file path"""
        node_config = {
            "fileUploads": [
                {
                    "name": "missing_file",
                    "type": "path",
                    "value": "/nonexistent/path/file.pdf",
                    "fieldName": "file",
                    "mimeType": "application/pdf",
                }
            ]
        }

        file_ref = node_config["fileUploads"][0]
        with pytest.raises(Exception):
            await executor._get_file_content(file_ref)

    @pytest.mark.asyncio
    async def test_path_traversal_attack_blocked(self, executor):
        """Test that path traversal is prevented"""
        node_config = {
            "fileUploads": [
                {
                    "name": "attack",
                    "type": "path",
                    "value": "/uploads/../../../etc/passwd",
                    "fieldName": "file",
                }
            ]
        }

        file_ref = node_config["fileUploads"][0]
        with pytest.raises(Exception) as exc_info:
            await executor._get_file_content(file_ref)

        assert "traversal" in str(exc_info.value).lower() or "failed" in str(exc_info.value).lower()

    @pytest.mark.asyncio
    async def test_invalid_reference_type(self, executor):
        """Test error with unknown reference type"""
        node_config = {
            "fileUploads": [
                {
                    "name": "invalid",
                    "type": "unknown_type",
                    "value": "something",
                    "fieldName": "file",
                }
            ]
        }

        file_ref = node_config["fileUploads"][0]
        with pytest.raises(Exception):
            await executor._get_file_content(file_ref)


if __name__ == "__main__":
    pytest.main([__file__, "-v", "--tb=short"])
