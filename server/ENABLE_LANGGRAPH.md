# How to Enable LangGraph Orchestrator

## Quick Enable

### Option 1: Environment Variable (Recommended)
```bash
export USE_LANGGRAPH_ORCHESTRATOR=true
# Then restart your server
```

### Option 2: .env File
Add to your `.env` file:
```
USE_LANGGRAPH_ORCHESTRATOR=true
```

### Option 3: Docker Compose (dev)
Add under **`chat2chart-server` → `environment`** in **`docker-compose.dev.yml`**, or set in root **`.env`** (already supported — see `USE_LANGGRAPH_ORCHESTRATOR` in `.env.example`):
```yaml
environment:
  - USE_LANGGRAPH_ORCHESTRATOR=true
```
Then `docker compose -f docker-compose.dev.yml up -d --build` (or restart **chat2chart-server**).

## Verify It's Enabled

1. **Check Server Logs**: Look for:
   ```
   🚀 Using LangGraph orchestrator (feature flag enabled)
   ```

2. **Check Frontend Console**: After sending a query, check browser console:
   ```
   ✅ LangGraph orchestrator is active!
   ```

3. **Check Response**: The response should include:
   ```json
   {
     "ai_engine": "AI Multi-Agent Framework",
     "progress": {
       "percentage": 100,
       "message": "Workflow completed successfully",
       "stage": "complete"
     }
   }
   ```

## Troubleshooting

### If you see "Using old orchestrator" in console:
1. Make sure environment variable is set: `echo $USE_LANGGRAPH_ORCHESTRATOR`
2. Restart the server after setting the variable
3. Check server logs for any import errors

### If LangGraph import fails:
```bash
pip install langgraph>=0.2.0
```

### If you want to disable:
```bash
unset USE_LANGGRAPH_ORCHESTRATOR
# Or set to false
export USE_LANGGRAPH_ORCHESTRATOR=false
```

