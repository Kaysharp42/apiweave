from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from typing import Any

from pymongo import ReturnDocument

from app.models import IdempotencyKey

_TTL_SECONDS = 86400


@dataclass
class IdempotencyEntry:
    run_id: str
    collection_run_id: str | None
    timestamp: float
    status_code: int
    response_body: dict[str, Any]


def _entry_from_document(document: IdempotencyKey) -> IdempotencyEntry:
    return IdempotencyEntry(
        run_id=document.runId,
        collection_run_id=document.collectionRunId,
        timestamp=document.expires_at.timestamp(),
        status_code=document.statusCode,
        response_body=document.responseBody,
    )


def _entry_from_raw_document(document: dict[str, Any]) -> IdempotencyEntry:
    timestamp_value = document["expires_at"]
    timestamp = timestamp_value.timestamp() if isinstance(timestamp_value, datetime) else 0.0
    return IdempotencyEntry(
        run_id=document["runId"],
        collection_run_id=document.get("collectionRunId"),
        timestamp=timestamp,
        status_code=document["statusCode"],
        response_body=document["responseBody"],
    )


async def get_idempotency_entry(
    webhook_id: str,
    idempotency_key: str,
) -> IdempotencyEntry | None:
    cutoff = datetime.now(UTC) - timedelta(seconds=_TTL_SECONDS)
    document = await IdempotencyKey.find_one(
        IdempotencyKey.webhookId == webhook_id,
        IdempotencyKey.idempotencyKey == idempotency_key,
        IdempotencyKey.expires_at >= cutoff,
    )
    if document is None:
        return None
    return _entry_from_document(document)


async def store_idempotency_entry(
    webhook_id: str,
    idempotency_key: str,
    run_id: str,
    collection_run_id: str | None,
    status_code: int,
    response_body: dict[str, Any],
) -> IdempotencyEntry:
    inserted_at = datetime.now(UTC)
    document = await IdempotencyKey.get_motor_collection().find_one_and_update(
        {"webhookId": webhook_id, "idempotencyKey": idempotency_key},
        {
            "$setOnInsert": {
                "webhookId": webhook_id,
                "idempotencyKey": idempotency_key,
                "runId": run_id,
                "collectionRunId": collection_run_id,
                "statusCode": status_code,
                "responseBody": response_body,
                "expires_at": inserted_at,
            }
        },
        upsert=True,
        return_document=ReturnDocument.AFTER,
    )
    return _entry_from_raw_document(document)


async def get_cached_response(webhook_id: str, idempotency_key: str) -> dict[str, Any] | None:
    entry = await get_idempotency_entry(webhook_id, idempotency_key)
    if entry is None:
        return None
    return entry.response_body


async def check_idempotency(webhook_id: str, idempotency_key: str) -> bool:
    return await get_idempotency_entry(webhook_id, idempotency_key) is not None


async def store_idempotency_response(
    webhook_id: str,
    idempotency_key: str,
    run_id: str,
    collection_run_id: str | None,
    status_code: int,
    response_body: dict[str, Any],
) -> IdempotencyEntry:
    return await store_idempotency_entry(
        webhook_id=webhook_id,
        idempotency_key=idempotency_key,
        run_id=run_id,
        collection_run_id=collection_run_id,
        status_code=status_code,
        response_body=response_body,
    )
