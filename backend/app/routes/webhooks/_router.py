"""Shared router instance for webhook routes."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/webhooks", tags=["webhooks"])
