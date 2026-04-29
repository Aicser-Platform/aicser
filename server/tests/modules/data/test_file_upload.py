"""
Test file upload functionality for data API
Tests the /data/upload endpoint with various scenarios
"""
import pytest
import io
import sys
from typing import Optional
from unittest.mock import patch, MagicMock, AsyncMock, Mock, ANY
from fastapi import FastAPI
from fastapi.testclient import TestClient


# Mock all heavy dependencies BEFORE any app imports
sys.modules['litellm'] = MagicMock()
sys.modules['anthropic'] = MagicMock()
sys.modules['openai'] = MagicMock()
sys.modules['app.modules.ai'] = MagicMock()
sys.modules['app.modules.ai.api'] = MagicMock()
sys.modules['app.modules.ai.services'] = MagicMock()
sys.modules['app.modules.ai.services.litellm_service'] = MagicMock()
sys.modules['app.modules.ai.services.ai_orchestrator'] = MagicMock()
sys.modules['app.modules.charts.services.chart_generation_service'] = MagicMock()


@pytest.fixture
def mock_data_service():
    """Mock data connectivity service"""
    mock = AsyncMock()
    # Default mock returns
    mock.get_data_sources = AsyncMock(return_value=[])
    mock.upload_file = AsyncMock(return_value={
        "success": True,
        "data_source": {"id": "test-id"}
    })
    return mock


@pytest.fixture
def app(mock_data_service):
    """Create a minimal FastAPI app with upload endpoint for testing"""
    from fastapi import FastAPI, File, UploadFile, Form, HTTPException
    
    app = FastAPI()
    # Store mock service in app state
    app.state.data_service = mock_data_service
    
    @app.post("/data/upload")
    async def upload_file(
        file: UploadFile = File(...),
        name: Optional[str] = Form(default=None),
        include_preview: Optional[str] = Form(default=None),
        sheet_name: Optional[str] = Form(default=None),
        delimiter: Optional[str] = Form(default=None),
        preview_only: Optional[str] = Form(default=None),
        upload_with_prompt: Optional[str] = Form(default=None),
        project_id: Optional[str] = Form(default=None),
    ):
        """Simplified upload endpoint for testing"""
        user_id = "test-user-123"
        
        # Validate project_id
        if not project_id:
            raise HTTPException(status_code=400, detail="project_id is required")
        
        # Validate file
        if not file or not file.filename:
            raise HTTPException(status_code=422, detail="No file provided")
        
        # Read file content
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="File is empty")
        if len(content) > 50 * 1024 * 1024:
            raise HTTPException(status_code=400, detail="File size exceeds 50MB limit")
        
        # Auto-generate name
        if not name or name.strip() == '':
            name = file.filename.rsplit('.', 1)[0] if '.' in file.filename else file.filename
        
        # Prepare options
        options = {
            'include_data': include_preview == "true",
            'sheet_name': sheet_name,
            'delimiter': delimiter or ',',
            'user_id': user_id,
            'project_id': project_id,
            'upload_with_prompt': upload_with_prompt == "true",
            'preview_only': preview_only == "true",
        }
        
        # Check for duplicates
        data_service = app.state.data_service
        existing = await data_service.get_data_sources()
        if any((ds.get('name') or '').lower() == name.lower() for ds in existing):
            raise HTTPException(status_code=400, detail="A data source with this name already exists")
        
        # Call mocked service
        try:
            result = await data_service.upload_file(file, name, options)
            
            if result.get('success'):
                data_source = result.get('data_source', {})
                data_source.setdefault('user_id', user_id)
                data_source.setdefault('project_id', project_id)
                
                return {
                    "success": True,
                    "data_source": data_source,
                    "message": "File uploaded successfully"
                }
            else:
                raise HTTPException(
                    status_code=400,
                    detail=f"File upload failed: {result.get('error', 'Unknown error')}"
                )
        except HTTPException:
            raise
        except Exception as e:
            raise HTTPException(status_code=500, detail=str(e))
    
    return app


@pytest.fixture
def client(app):
    """Create test client"""
    return TestClient(app)


@pytest.fixture
def sample_csv_file():
    """Create a sample CSV file"""
    csv_content = b"name,age,city\nJohn,30,NYC\nJane,25,LA\nBob,35,SF"
    return ("test_data.csv", csv_content, "text/csv")



@pytest.fixture
def sample_xlsx_file():
    """Create a sample Excel file (minimal valid format)"""
    # Minimal XLSX file structure (this is simplified)
    xlsx_content = b"PK\x03\x04" + b"\x00" * 100  # Simplified XLSX header
    return ("test_data.xlsx", xlsx_content, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")


@pytest.fixture
def large_file():
    """Create a file larger than 50MB"""
    large_content = b"x" * (51 * 1024 * 1024)  # 51MB
    return ("large_file.csv", large_content, "text/csv")


@pytest.fixture
def invalid_file():
    """Create an invalid file type"""
    return ("test.exe", b"invalid content", "application/x-msdownload")


class TestFileUpload:
    """Test suite for file upload endpoint"""

    def test_successful_file_upload_with_project_id(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test successful file upload with valid project_id"""
        filename, content, content_type = sample_csv_file
        
        # Mock successful upload response
        mock_data_service.upload_file = AsyncMock(return_value={
            "success": True,
            "data_source": {
                "id": "ds-123",
                "name": "test_data",
                "type": "file",
                "format": "csv",
                "size": len(content),
                "row_count": 3,
                "schema": [
                    {"name": "name", "type": "string"},
                    {"name": "age", "type": "integer"},
                    {"name": "city", "type": "string"}
                ],
                "uploaded_at": "2026-02-16T00:00:00Z",
                "user_id": "test-user-123",
                "project_id": "1"
            }
        })
        
        # Mock get_data_sources to return empty list (no duplicates)
        mock_data_service.get_data_sources = AsyncMock(return_value=[])
        
        # Prepare request
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Test Data Source",
            "project_id": "1",
            "include_preview": "false"
        }
        
        # Make request
        response = client.post("/data/upload", files=files, data=data)
        
        # Assertions
        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True
        assert result["data_source"]["id"] == "ds-123"
        assert result["data_source"]["project_id"] == "1"
        assert "row_count" in result["data_source"]


    def test_file_upload_without_project_id(
        self, client, sample_csv_file
    ):
        """Test file upload fails without project_id"""
        filename, content, content_type = sample_csv_file
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {"name": "Test Data Source"}
        
        response = client.post("/data/upload", files=files, data=data)
        
        # Should fail with 400 Bad Request
        assert response.status_code == 400
        assert "project_id is required" in response.json()["detail"]


    def test_file_upload_without_file(self, client):
        """Test file upload fails when no file is provided"""
        data = {
            "name": "Test Data Source",
            "project_id": "1"
        }
        
        response = client.post("/data/upload", data=data)
        
        # Should fail with 422 (validation error for missing required field)
        assert response.status_code == 422


    def test_file_upload_empty_file(self, client):
        """Test file upload fails with empty file"""
        files = {"file": ("empty.csv", io.BytesIO(b""), "text/csv")}
        data = {
            "name": "Test Data Source",
            "project_id": "1"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        # Should fail with 400 Bad Request
        assert response.status_code == 400
        assert "empty" in response.json()["detail"].lower()


    def test_file_upload_excel_file(
        self, client, mock_data_service, sample_xlsx_file
    ):
        """Test successful upload of Excel file"""
        filename, content, content_type = sample_xlsx_file
        
        mock_data_service.upload_file = AsyncMock(return_value={
            "success": True,
            "data_source": {
                "id": "ds-456",
                "name": "test_data",
                "type": "file",
                "format": "xlsx",
                "size": len(content),
                "row_count": 10,
                "project_id": "1"
            }
        })
        
        mock_data_service.get_data_sources = AsyncMock(return_value=[])
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Excel Test",
            "project_id": "1"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True


    def test_file_upload_with_options(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test file upload with additional options"""
        filename, content, content_type = sample_csv_file
        
        mock_data_service.upload_file = AsyncMock(return_value={
            "success": True,
            "data_source": {
                "id": "ds-789",
                "name": "test_with_options",
                "type": "file",
                "format": "csv",
                "project_id": "1"
            }
        })
        
        mock_data_service.get_data_sources = AsyncMock(return_value=[])
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Test with Options",
            "project_id": "1",
            "include_preview": "true",
            "delimiter": ",",
            "sheet_name": "Sheet1"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        assert response.status_code == 200
        
        # Verify options were passed to service
        call_args = mock_data_service.upload_file.call_args
        assert call_args is not None
        options = call_args[0][2]  # Third argument is options
        assert options["include_data"] is True
        assert options["delimiter"] == ","
        assert options["project_id"] == "1"


    def test_file_upload_preview_only(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test file upload in preview-only mode"""
        filename, content, content_type = sample_csv_file
        
        mock_data_service.upload_file = AsyncMock(return_value={
            "success": True,
            "data_source": {
                "preview_data": [
                    {"name": "John", "age": 30, "city": "NYC"},
                    {"name": "Jane", "age": 25, "city": "LA"}
                ],
                "schema": [
                    {"name": "name", "type": "string"},
                    {"name": "age", "type": "integer"},
                    {"name": "city", "type": "string"}
                ],
                "row_count": 3
            }
        })  
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Preview Test",
            "project_id": "1",
            "preview_only": "true"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        assert response.status_code == 200
        result = response.json()
        assert result["success"] is True
        assert "preview_data" in result["data_source"]


    def test_file_upload_duplicate_name(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test file upload fails with duplicate name"""
        filename, content, content_type = sample_csv_file
        
        # Mock existing data source with same name
        mock_data_service.get_data_sources = AsyncMock(return_value=[
            {"id": "existing", "name": "Test Data Source"}
        ])
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Test Data Source",
            "project_id": "1"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        # Should fail with 400 Bad Request
        assert response.status_code == 400
        assert "already exists" in response.json()["detail"]


    def test_file_upload_auto_name_generation(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test file upload with auto-generated name from filename"""
        filename, content, content_type = sample_csv_file
        
        mock_data_service.upload_file = AsyncMock(return_value={
            "success": True,
            "data_source": {
                "id": "ds-auto",
                "name": "test_data",  # Auto-generated from filename
                "type": "file",
                "format": "csv",
                "project_id": "1"
            }
        })
        
        mock_data_service.get_data_sources = AsyncMock(return_value=[])
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "project_id": "1"
            # No name provided - should auto-generate
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        assert response.status_code == 200


    def test_file_upload_service_failure(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test file upload handles service failure gracefully"""
        filename, content, content_type = sample_csv_file
        
        # Mock service failure
        mock_data_service.upload_file = AsyncMock(return_value={
            "success": False,
            "error": "Database connection failed"
        })
        
        mock_data_service.get_data_sources = AsyncMock(return_value=[])
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Test Failure",
            "project_id": "1"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        # Should fail with 400 Bad Request
        assert response.status_code == 400
        assert "Database connection failed" in response.json()["detail"]


    def test_file_upload_with_upload_with_prompt_flag(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test file upload with upload_with_prompt flag for in-memory storage"""
        filename, content, content_type = sample_csv_file
        
        mock_data_service.upload_file = AsyncMock(return_value={
            "success": True,
            "data_source": {
                "id": "ds-prompt",
                "name": "prompt_upload",
                "type": "file",
                "project_id": "1"
            }
        })
        
        mock_data_service.get_data_sources = AsyncMock(return_value=[])
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Prompt Upload",
            "project_id": "1",
            "upload_with_prompt": "true"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        assert response.status_code == 200
        
        # Verify upload_with_prompt was passed to service
        call_args = mock_data_service.upload_file.call_args
        options = call_args[0][2]
        assert options["upload_with_prompt"] is True


class TestFileUploadEdgeCases:
    """Test edge cases and error conditions"""

    def test_file_upload_with_special_characters_in_name(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test file upload with special characters in name"""
        filename, content, content_type = sample_csv_file
        
        mock_data_service.upload_file = AsyncMock(return_value={
            "success": True,
            "data_source": {
                "id": "ds-special",
                "name": "Test (Special) [Data]",
                "project_id": "1"
            }
        })
        
        mock_data_service.get_data_sources = AsyncMock(return_value=[])
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Test (Special) [Data]",
            "project_id": "1"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        assert response.status_code == 200


    def test_file_upload_with_numeric_project_id(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test file upload accepts numeric project_id"""
        filename, content, content_type = sample_csv_file
        
        mock_data_service.upload_file = AsyncMock(return_value={
            "success": True,
            "data_source": {
                "id": "ds-numeric",
                "name": "test",
                "project_id": "123"
            }
        })
        
        mock_data_service.get_data_sources = AsyncMock(return_value=[])
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Numeric Project",
            "project_id": "123"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        assert response.status_code == 200


    def test_file_upload_exception_handling(
        self, client, mock_data_service, sample_csv_file
    ):
        """Test file upload handles unexpected exceptions"""
        filename, content, content_type = sample_csv_file
        
        # Mock service to raise exception
        mock_data_service.upload_file = AsyncMock(
            side_effect=Exception("Unexpected error occurred")
        )
        
        mock_data_service.get_data_sources = AsyncMock(return_value=[])
        
        files = {"file": (filename, io.BytesIO(content), content_type)}
        data = {
            "name": "Exception Test",
            "project_id": "1"
        }
        
        response = client.post("/data/upload", files=files, data=data)
        
        # Should fail with 500 Internal Server Error
        assert response.status_code == 500
        assert "Unexpected error occurred" in response.json()["detail"]


if __name__ == "__main__":
    pytest.main([__file__, "-v"])
