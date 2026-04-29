import os
import pytest

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip("Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.", allow_module_level=True)

"""
Integration test for file upload with actual database
This test helps debug database save issues
"""
import pytest
import io
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, text
from sqlalchemy.orm import sessionmaker
from src.main import app
from src.db.session import get_async_session
import asyncio


@pytest.fixture
def client():
    """Create test client"""
    return TestClient(app)


@pytest.fixture
def authenticated_client(client):
    """Client with authentication cookie"""
    # Set a test token (requires ALLOW_DEV_AUTH_BYPASS=true in env)
    client.cookies.set("c2c_access_token", "dev-test-token")
    return client


def test_file_upload_integration(authenticated_client):
    """
    Integration test with actual database
    This test requires:
    - Database to be running
    - Environment variables configured
    - ALLOW_DEV_AUTH_BYPASS=true
    """
    
    # Create a simple CSV file
    csv_content = b"id,name,value\n1,Test,100\n2,Demo,200"
    
    files = {
        "file": ("integration_test.csv", io.BytesIO(csv_content), "text/csv")
    }
    
    data = {
        "name": "Integration Test Data",
        "project_id": "1",  # Use project ID 1 (should exist)
        "include_preview": "false"
    }
    
    print("\n" + "="*60)
    print("🧪 Running Integration Test")
    print("="*60)
    
    try:
        response = authenticated_client.post("/data/upload", files=files, data=data)
        
        print(f"\n📊 Response Status: {response.status_code}")
        print(f"📄 Response Body: {response.json()}")
        
        if response.status_code == 200:
            print("\n✅ Upload successful!")
            result = response.json()
            
            if result.get("success"):
                data_source = result.get("data_source", {})
                print(f"   - Data Source ID: {data_source.get('id')}")
                print(f"   - Name: {data_source.get('name')}")
                print(f"   - Project ID: {data_source.get('project_id')}")
                print(f"   - Row Count: {data_source.get('row_count')}")
                
                # Cleanup - delete the test data source
                ds_id = data_source.get('id')
                if ds_id:
                    delete_response = authenticated_client.delete(f"/data/sources/{ds_id}")
                    print(f"\n🗑️  Cleanup: Deleted test data source (Status: {delete_response.status_code})")
            else:
                print(f"\n❌ Upload failed: {result.get('error')}")
                
        else:
            print(f"\n❌ Request failed with status {response.status_code}")
            print(f"   Detail: {response.json().get('detail', 'No detail provided')}")
            
        assert response.status_code == 200, f"Expected 200, got {response.status_code}"
        assert response.json().get("success") is True, "Upload should succeed"
        
    except Exception as e:
        print(f"\n❌ Exception occurred: {str(e)}")
        print(f"   Type: {type(e).__name__}")
        import traceback
        print(f"\n📋 Traceback:")
        traceback.print_exc()
        raise


def test_file_upload_without_project_id_integration(authenticated_client):
    """Test that upload fails without project_id"""
    
    csv_content = b"id,name\n1,Test"
    
    files = {
        "file": ("test.csv", io.BytesIO(csv_content), "text/csv")
    }
    
    data = {
        "name": "No Project Test"
        # No project_id provided
    }
    
    print("\n" + "="*60)
    print("🧪 Testing Upload Without Project ID")
    print("="*60)
    
    response = authenticated_client.post("/data/upload", files=files, data=data)
    
    print(f"\n📊 Response Status: {response.status_code}")
    print(f"📄 Response Body: {response.json()}")
    
    # Should fail with 400
    assert response.status_code == 400, "Should fail without project_id"
    assert "project_id" in response.json()["detail"].lower(), "Error should mention project_id"
    
    print("\n✅ Correctly rejected upload without project_id")


def test_database_connection():
    """Test that database connection is working"""
    
    print("\n" + "="*60)
    print("🧪 Testing Database Connection")
    print("="*60)
    
    try:
        from src.db.session import async_engine
        from sqlalchemy import text
        
        async def check_db():
            async with async_engine.connect() as conn:
                result = await conn.execute(text("SELECT 1"))
                return result.scalar()
        
        result = asyncio.run(check_db())
        print(f"\n✅ Database connection successful! (Query result: {result})")
        
    except Exception as e:
        print(f"\n❌ Database connection failed: {str(e)}")
        raise


def test_project_exists():
    """Test that project with ID 1 exists in database"""
    
    print("\n" + "="*60)
    print("🧪 Checking if Project 1 Exists")
    print("="*60)
    
    try:
        from src.db.session import async_engine
        from sqlalchemy import text
        
        async def check_project():
            async with async_engine.connect() as conn:
                result = await conn.execute(
                    text("SELECT id, name FROM projects WHERE id = 1")
                )
                return result.fetchone()
        
        project = asyncio.run(check_project())
        
        if project:
            print(f"\n✅ Project found!")
            print(f"   - ID: {project[0]}")
            print(f"   - Name: {project[1]}")
        else:
            print("\n⚠️  Project with ID 1 not found in database")
            print("   You may need to create a project first")
            
    except Exception as e:
        print(f"\n❌ Failed to check project: {str(e)}")
        raise


if __name__ == "__main__":
    # Run with: python -m pytest app/tests/modules/data/test_file_upload_integration.py -v -s
    pytest.main([__file__, "-v", "-s"])
