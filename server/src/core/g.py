from contextvars import ContextVar

# Context variable to store request-specific user data
g = ContextVar("g", default={})
