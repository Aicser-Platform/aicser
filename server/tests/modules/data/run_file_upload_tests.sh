#!/bin/bash
# Run file upload tests with various options

echo "🧪 Running File Upload Tests..."
echo "================================"

cd "$(dirname "$0")/../../.."

# Activate virtual environment if it exists
if [ -d "venv" ]; then
    source venv/bin/activate
elif [ -d ".venv" ]; then
    source .venv/bin/activate
fi

# Run tests with different options
echo ""
echo "📋 Running all file upload tests..."
pytest app/tests/modules/data/test_file_upload.py -v

echo ""
echo "📊 Running with coverage report..."
pytest app/tests/modules/data/test_file_upload.py \
    --cov=app.modules.data.api \
    --cov=app.modules.data.services.data_connectivity_service \
    --cov-report=term-missing \
    --cov-report=html:htmlcov/file_upload

echo ""
echo "✅ Test Results:"
echo "   - View detailed coverage: open htmlcov/file_upload/index.html"

# Check exit code
if [ $? -eq 0 ]; then
    echo ""
    echo "✅ All tests passed!"
    exit 0
else
    echo ""
    echo "❌ Some tests failed. Check the output above."
    exit 1
fi
