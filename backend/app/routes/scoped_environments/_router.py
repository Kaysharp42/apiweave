"""Shared router instance for scoped environment routes."""

from fastapi import APIRouter

router = APIRouter(tags=["scoped-environments"])
