from typing import Annotated
import uuid

# User model removed - user management will be handled by Supabase
from src.db.session import async_session
from fastapi import Depends
from fastapi.security import OAuth2PasswordBearer
from passlib.context import CryptContext

oauth2_scheme = OAuth2PasswordBearer(tokenUrl="token")

TokenDep = Annotated[str, Depends(oauth2_scheme)]


async def get_current_user(token: Annotated[str, Depends(oauth2_scheme)]):
    """
    Get current user - stub for clean slate.
    User management will be handled by Supabase.
    """
    # Return minimal user info from token
    # Full implementation will be done with Supabase integration
    class FakeUser:
        def __init__(self):
            self.id = uuid.UUID("7d4fd121-913e-4cd6-882a-b939778f9f76")
            self.username = "test-user"
            self.email = "test@example.com"
            self.first_name = "Test"
            self.last_name = "User"
            self.organization_id = None
    
    return FakeUser()


# Password hashing removed - will be handled by Supabase
