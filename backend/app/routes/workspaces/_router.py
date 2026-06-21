"""Shared router instance for workspace routes."""

from fastapi import APIRouter

router = APIRouter(prefix="/api/workspaces", tags=["workspaces"])
