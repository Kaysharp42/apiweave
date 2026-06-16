"""
OAuthLinkingBlockedError is raised when the account-linking guard
prevents an OAuth provider from being linked to an existing user.
"""

from fastapi import HTTPException, status


class OAuthLinkingBlockedError(HTTPException):
    """
    Raised when account linking is refused.

    The user already has an OAuth account linked, or the email is
    already associated with a different user.  Always returns HTTP 409.
    """

    def __init__(self, detail: str = "Account linking is not supported") -> None:
        super().__init__(status_code=status.HTTP_409_CONFLICT, detail=detail)
