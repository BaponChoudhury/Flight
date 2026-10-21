"""SQLite state store (aiosqlite).

Two tables:
- ``offers``  — every fare returned by a search, so checkout re-prices from server-held data
                and never trusts a price sent by the client.
- ``orders``  — accepted checkouts with the passenger payload and the full ledger.
                ``payment_reference`` is UNIQUE, which makes checkout idempotent.
"""

from __future__ import annotations

import json
import logging
import uuid
from datetime import datetime, timezone
from typing import Any

import aiosqlite

from app.schemas import FlightFare

logger = logging.getLogger(__name__)

_SCHEMA = """
CREATE TABLE IF NOT EXISTS offers (
    offer_id     TEXT PRIMARY KEY,
    adults       INTEGER NOT NULL,
    fare_json    TEXT NOT NULL,
    expires_at   TEXT NOT NULL,
    created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS offers_expires_idx ON offers (expires_at);

CREATE TABLE IF NOT EXISTS orders (
    order_id              TEXT PRIMARY KEY,
    offer_id              TEXT NOT NULL REFERENCES offers (offer_id),
    payment_reference     TEXT NOT NULL UNIQUE,
    status                TEXT NOT NULL,
    contact_json          TEXT NOT NULL,
    passengers_json       TEXT NOT NULL,
    ledger_json           TEXT NOT NULL,
    instructions_json     TEXT NOT NULL,
    notification_json     TEXT,
    created_at            TEXT NOT NULL,
    updated_at            TEXT NOT NULL
);
"""


class DuplicatePaymentError(Exception):
    """A checkout with this payment reference already exists."""


class Database:
    def __init__(self, path: str) -> None:
        self._path = path
        self._conn: aiosqlite.Connection | None = None

    async def connect(self) -> None:
        self._conn = await aiosqlite.connect(self._path)
        self._conn.row_factory = aiosqlite.Row
        await self._conn.execute("PRAGMA journal_mode=WAL")
        await self._conn.execute("PRAGMA foreign_keys=ON")
        await self._conn.executescript(_SCHEMA)
        await self._conn.commit()
        logger.info("SQLite ready at %s", self._path)

    async def close(self) -> None:
        if self._conn is not None:
            await self._conn.close()
            self._conn = None

    @property
    def conn(self) -> aiosqlite.Connection:
        if self._conn is None:
            raise RuntimeError("database is not connected")
        return self._conn

    # -- offers ---------------------------------------------------------------

    async def save_offers(self, fares: list[FlightFare], adults: int) -> None:
        now = _now()
        await self.conn.executemany(
            "INSERT OR REPLACE INTO offers (offer_id, adults, fare_json, expires_at, created_at) VALUES (?, ?, ?, ?, ?)",
            [(f.offer_id, adults, f.model_dump_json(), f.expires_at.isoformat(), now) for f in fares],
        )
        await self.conn.execute("DELETE FROM offers WHERE expires_at < ? AND offer_id NOT IN (SELECT offer_id FROM orders)", (now,))
        await self.conn.commit()

    async def get_offer(self, offer_id: str) -> tuple[FlightFare, int] | None:
        async with self.conn.execute("SELECT fare_json, adults FROM offers WHERE offer_id = ?", (offer_id,)) as cur:
            row = await cur.fetchone()
        if row is None:
            return None
        return FlightFare.model_validate_json(row["fare_json"]), int(row["adults"])

    # -- orders ---------------------------------------------------------------

    async def create_order(
        self,
        *,
        offer_id: str,
        payment_reference: str,
        contact: dict[str, Any],
        passengers: list[dict[str, Any]],
        ledger: dict[str, Any],
        instructions: dict[str, Any],
    ) -> tuple[str, str]:
        """Insert an order atomically. Returns (order_id, created_at)."""
        order_id = f"ord_{uuid.uuid4().hex[:20]}"
        now = _now()
        try:
            await self.conn.execute(
                """INSERT INTO orders (order_id, offer_id, payment_reference, status, contact_json, passengers_json,
                                       ledger_json, instructions_json, created_at, updated_at)
                   VALUES (?, ?, ?, 'pending_manual_booking', ?, ?, ?, ?, ?, ?)""",
                (order_id, offer_id, payment_reference, _dumps(contact), _dumps(passengers), _dumps(ledger), _dumps(instructions), now, now),
            )
            await self.conn.commit()
        except aiosqlite.IntegrityError as exc:
            await self.conn.rollback()
            if "payment_reference" in str(exc):
                raise DuplicatePaymentError(payment_reference) from exc
            raise
        return order_id, now

    async def get_order_by_payment_reference(self, payment_reference: str) -> dict[str, Any] | None:
        async with self.conn.execute("SELECT * FROM orders WHERE payment_reference = ?", (payment_reference,)) as cur:
            row = await cur.fetchone()
        return _order_row(row) if row else None

    async def get_order(self, order_id: str) -> dict[str, Any] | None:
        async with self.conn.execute("SELECT * FROM orders WHERE order_id = ?", (order_id,)) as cur:
            row = await cur.fetchone()
        return _order_row(row) if row else None

    async def set_notification(self, order_id: str, notification: dict[str, Any]) -> None:
        await self.conn.execute(
            "UPDATE orders SET notification_json = ?, updated_at = ? WHERE order_id = ?",
            (_dumps(notification), _now(), order_id),
        )
        await self.conn.commit()


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _dumps(value: Any) -> str:
    return json.dumps(value, default=str, separators=(",", ":"))


def _order_row(row: aiosqlite.Row) -> dict[str, Any]:
    return {
        "order_id": row["order_id"],
        "offer_id": row["offer_id"],
        "payment_reference": row["payment_reference"],
        "status": row["status"],
        "contact": json.loads(row["contact_json"]),
        "passengers": json.loads(row["passengers_json"]),
        "ledger": json.loads(row["ledger_json"]),
        "instructions": json.loads(row["instructions_json"]),
        "notification": json.loads(row["notification_json"]) if row["notification_json"] else None,
        "created_at": row["created_at"],
    }
