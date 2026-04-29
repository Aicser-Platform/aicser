# Debugging File Upload Database Save Failure

## Error Message
```json
{
  "detail": "File upload failed: Failed to save data source to database. Check logs for details."
}
```

## Quick Diagnosis Steps

### 1. Run Integration Tests
```bash
cd packages/chat2chart/server

# Test database connection
pytest app/tests/modules/data/test_file_upload_integration.py::test_database_connection -v -s

# Test project exists
pytest app/tests/modules/data/test_file_upload_integration.py::test_project_exists -v -s

# Test actual upload
pytest app/tests/modules/data/test_file_upload_integration.py::test_file_upload_integration -v -s
```

### 2. Check Backend Logs
Look for these error patterns in your Docker logs:
```bash
docker compose -f docker-compose.dev.yml logs chat2chart-server | grep -i "error\|failed\|exception"
```

Common errors to look for:
- `PostgresStorageService.store_file() got an unexpected keyword argument 'user_id'` ✅ FIXED
- `project_id is required` ← Our new validation
- `IntegrityError` ← Database constraint violation
- `Column 'project_id' not found` ← Schema mismatch
- `Foreign key constraint fails` ← Invalid project_id

### 3. Verify Database Schema

Check that FileStorage table has project_id column:
```sql
-- Connect to your database
docker compose -f docker-compose.dev.yml exec postgres psql -U aiser -d aiser_world

-- Check FileStorage table schema
\d file_storage

-- Should show:
--   project_id | uuid | not null
```

### 4. Check Data Flow

The file upload follows this path:
```
Frontend (FormData with project_id)
  ↓
API endpoint (/data/upload)
  ↓
data_connectivity_service.upload_file()
  ↓
postgres_storage_service.store_file(project_id=...)
  ↓
FileStorage model (project_id column)
  ↓
Database INSERT
```

### 5. Common Issues & Fixes

#### Issue 1: project_id not sent from frontend
**Symptom:** Error "project_id is required"

**Check:**
```typescript
// UniversalDataSourceModal.tsx
formData.append('project_id', currentProject.id.toString()); // ✅ Should be present
```

**Fix:** Update frontend to send project_id (already done)

---

#### Issue 2: Backend not receiving project_id
**Symptom:** Error "project_id is required" even when sent

**Check:** Backend API parameter
```python
# api.py
async def upload_file(
    project_id: Optional[str] = Form(default=None),  # ✅ Should be present
):
```

**Fix:** Add project_id parameter (already done)

---

#### Issue 3: Service still using user_id
**Symptom:** Error "unexpected keyword argument 'user_id'"

**Check:** data_connectivity_service.py
```python
# Should be:
object_key = await storage_service.store_file(
    project_id=project_id,  # ✅ Correct
    ...
)

# NOT:
object_key = await storage_service.store_file(
    user_id=user_id,  # ❌ Wrong
    ...
)
```

**Fix:** Change to project_id (already done)

---

#### Issue 4: Invalid project_id
**Symptom:** Foreign key constraint violation

**Check:** Does project exist?
```sql
SELECT id, name FROM projects WHERE id = 'YOUR_PROJECT_ID';
```

**Fix:** 
- Ensure project exists in database
- Frontend should only allow selecting valid projects
- Add project validation in backend

---

#### Issue 5: project_id format mismatch
**Symptom:** Type conversion error

**Check:** project_id type in database vs what's sent
```python
# FileStorage model expects UUID
project_id = Column(UUID(as_uuid=True), ...)

# Make sure we convert string to UUID properly
from uuid import UUID
project_id_uuid = UUID(project_id) if isinstance(project_id, str) else project_id
```

---

#### Issue 6: Database connection issue
**Symptom:** Connection timeout or refused

**Check:**
```bash
# Test database is accessible
docker compose -f docker-compose.dev.yml exec postgres pg_isready

# Check connection string
echo $DATABASE_URL
```

**Fix:**
- Restart database: `docker compose -f docker-compose.dev.yml restart postgres`
- Check DATABASE_URL in .env
- Verify network connectivity

---

## Debugging Workflow

1. **Start with integration tests:**
   ```bash
   # This will print detailed info
   pytest app/tests/modules/data/test_file_upload_integration.py -v -s
   ```

2. **Check what the test reveals:**
   - ✅ Database connected → Move to next step
   - ❌ Database failed → Fix database connection
   - ✅ Project exists → Move to next step
   - ❌ Project missing → Create project or use different ID
   - ✅ Upload works → Issue is in frontend
   - ❌ Upload fails → Check error message details

3. **Look at actual server logs:**
   ```bash
   # Real-time logs
   docker compose -f docker-compose.dev.yml logs -f chat2chart-server
   
   # Then try upload from UI and watch logs
   ```

4. **Enable debug logging:**
   ```python
   # In data_connectivity_service.py, add more logging
   logger.info(f"💾 Storing file with project_id: {project_id}")
   logger.info(f"📦 Object key generated: {object_key}")
   ```

5. **Test with curl:**
   ```bash
   # Get your auth token from browser cookies
   curl -X POST http://localhost:8000/data/upload \
     -H "Cookie: c2c_access_token=YOUR_TOKEN" \
     -F "file=@test.csv" \
     -F "name=Test Upload" \
     -F "project_id=1"
   ```

## Expected Success Flow

When working correctly, you should see:
1. ✅ Frontend sends project_id in FormData
2. ✅ Backend validates project_id is present
3. ✅ Backend passes project_id to service
4. ✅ Service calls store_file(project_id=...)
5. ✅ FileStorage record created with project_id
6. ✅ File data saved to database
7. ✅ DataSource record created
8. ✅ Success response returned

## Quick Test Command

Run all checks at once:
```bash
cd packages/chat2chart/server

# Run all checks
pytest app/tests/modules/data/test_file_upload_integration.py -v -s

# If all pass, issue is likely in frontend integration
# If some fail, check the specific failure reason
```

## Still Having Issues?

1. **Check the actual error in logs:**
   ```bash
   docker compose -f docker-compose.dev.yml logs chat2chart-server | tail -100
   ```

2. **Verify all changes were applied:**
   - [ ] api.py has project_id parameter
   - [ ] api.py validates project_id is required
   - [ ] api.py adds project_id to options
   - [ ] data_connectivity_service.py uses project_id (not user_id)
   - [ ] postgres_storage_service.py has project_id parameter
   - [ ] Frontend sends project_id in FormData

3. **Restart services:**
   ```bash
   docker compose -f docker-compose.dev.yml restart
   ```

4. **Check for any uncommitted changes:**
   ```bash
   git status
   git diff
   ```
