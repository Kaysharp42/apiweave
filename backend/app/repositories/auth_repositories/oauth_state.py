from datetime import datetime

from app.models import OAuthState


class OAuthStateRepository:
    @staticmethod
    async def create(
        state_id: str,
        state: str,
        code_verifier: str,
        nonce: str,
        provider: str,
        redirect_uri: str,
        expires_at: datetime,
        invite_token: str | None = None,
    ) -> OAuthState:
        oauth_state = OAuthState(
            stateId=state_id,
            state=state,
            code_verifier=code_verifier,
            nonce=nonce,
            provider=provider,
            redirect_uri=redirect_uri,
            invite_token=invite_token,
            expires_at=expires_at,
        )
        await oauth_state.insert()
        return oauth_state

    @staticmethod
    async def get_by_state(state: str) -> OAuthState | None:
        return await OAuthState.find_one(OAuthState.state == state)

    @staticmethod
    async def consume(state: str) -> OAuthState | None:
        oauth_state = await OAuthStateRepository.get_by_state(state)
        if not oauth_state:
            return None
        await oauth_state.delete()
        return oauth_state
