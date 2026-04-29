import os
import sys

# Ensure the repository's server package root is importable when running tests from repo root
# Insert packages/chat2chart/server so that `import app...` resolves correctly
tests_dir = os.path.dirname(__file__)
server_root = os.path.abspath(os.path.join(tests_dir, '..', '..'))
if server_root not in sys.path:
    sys.path.insert(0, server_root)

# Indicate tests are running so runtime DDL helpers skip creating tables
os.environ.setdefault('PYTEST_CURRENT_TEST', '1')
# Allow dev bypasses/unverified JWT claims in tests
os.environ.setdefault('ALLOW_UNVERIFIED_JWT_IN_DEV', 'true')
os.environ.setdefault('ALLOW_DEV_AUTH_BYPASS', 'true')
os.environ.setdefault('ENVIRONMENT', 'development')


