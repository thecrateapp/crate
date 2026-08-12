"""Add an authoritative queue, requests, votes, and queue mode to Jam rooms."""

from __future__ import annotations

import json

import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql


revision = "085"
down_revision = "084"
branch_labels = None
depends_on = None


def upgrade() -> None:
    inspector = sa.inspect(op.get_bind())
    room_columns = {column["name"] for column in inspector.get_columns("jam_rooms")}
    if "queue_mode" not in room_columns:
        op.add_column(
            "jam_rooms",
            sa.Column("queue_mode", sa.Text(), nullable=False, server_default="manual"),
        )
    op.execute(
        "UPDATE jam_rooms SET queue_mode = 'manual' WHERE queue_mode IS NULL OR queue_mode = ''"
    )

    if not inspector.has_table("jam_room_queue_items"):
        op.create_table(
            "jam_room_queue_items",
            sa.Column("id", sa.BIGINT(), primary_key=True, autoincrement=True),
            sa.Column(
                "room_id",
                postgresql.UUID(as_uuid=False),
                sa.ForeignKey("jam_rooms.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("track_payload", postgresql.JSONB(), nullable=False),
            sa.Column(
                "added_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("source", sa.Text(), nullable=False, server_default="owner"),
            sa.Column("status", sa.Text(), nullable=False, server_default="queued"),
            sa.Column("position", sa.Integer(), nullable=False, server_default="0"),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.Column("started_at", sa.DateTime(timezone=True), nullable=True),
            sa.Column("completed_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_index(
            "idx_jam_room_queue_items_room_status_position",
            "jam_room_queue_items",
            ["room_id", "status", "position"],
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("jam_room_track_requests"):
        op.create_table(
            "jam_room_track_requests",
            sa.Column("id", sa.BIGINT(), primary_key=True, autoincrement=True),
            sa.Column(
                "room_id",
                postgresql.UUID(as_uuid=False),
                sa.ForeignKey("jam_rooms.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("track_payload", postgresql.JSONB(), nullable=False),
            sa.Column(
                "requested_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("status", sa.Text(), nullable=False, server_default="pending"),
            sa.Column(
                "resolved_by",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="SET NULL"),
                nullable=True,
            ),
            sa.Column("queue_item_id", sa.BIGINT(), nullable=True),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
            sa.Column("resolved_at", sa.DateTime(timezone=True), nullable=True),
        )
        op.create_foreign_key(
            "fk_jam_request_queue_item",
            "jam_room_track_requests",
            "jam_room_queue_items",
            ["queue_item_id"],
            ["id"],
            ondelete="SET NULL",
        )
        op.create_index(
            "idx_jam_room_track_requests_room_status",
            "jam_room_track_requests",
            ["room_id", "status", "created_at"],
        )

    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table("jam_room_queue_votes"):
        op.create_table(
            "jam_room_queue_votes",
            sa.Column(
                "room_id",
                postgresql.UUID(as_uuid=False),
                sa.ForeignKey("jam_rooms.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "queue_item_id",
                sa.BIGINT(),
                sa.ForeignKey("jam_room_queue_items.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "user_id",
                sa.Integer(),
                sa.ForeignKey("users.id", ondelete="CASCADE"),
                primary_key=True,
            ),
            sa.Column(
                "created_at",
                sa.DateTime(timezone=True),
                nullable=False,
                server_default=sa.text("NOW()"),
            ),
        )
        op.create_index(
            "idx_jam_room_queue_votes_item",
            "jam_room_queue_votes",
            ["room_id", "queue_item_id"],
        )

    _backfill_legacy_queues()


def _backfill_legacy_queues() -> None:
    connection = op.get_bind()
    rooms = connection.execute(sa.text("SELECT id FROM jam_rooms")).mappings().all()
    for room in rooms:
        existing = connection.execute(
            sa.text(
                "SELECT 1 FROM jam_room_queue_items WHERE room_id = :room_id LIMIT 1"
            ),
            {"room_id": room["id"]},
        ).first()
        if existing:
            continue

        events = (
            connection.execute(
                sa.text(
                    """
                SELECT user_id, event_type, payload_json, created_at
                FROM jam_room_events
                WHERE room_id = :room_id
                  AND event_type IN ('queue_add', 'queue_remove', 'queue_reorder')
                ORDER BY id ASC
                """
                ),
                {"room_id": room["id"]},
            )
            .mappings()
            .all()
        )
        queue: list[dict] = []
        for event in events:
            payload = event["payload_json"] or {}
            if isinstance(payload, str):
                payload = json.loads(payload)
            if event["event_type"] == "queue_add" and payload.get("track"):
                index = payload.get("index")
                item = {
                    "track": payload["track"],
                    "added_by": event["user_id"],
                    "created_at": event["created_at"],
                }
                if isinstance(index, int) and 0 <= index <= len(queue):
                    queue.insert(index, item)
                else:
                    queue.append(item)
            elif event["event_type"] == "queue_remove":
                index = payload.get("index")
                if isinstance(index, int) and 0 <= index < len(queue):
                    queue.pop(index)
            elif event["event_type"] == "queue_reorder":
                from_index = payload.get("fromIndex")
                to_index = payload.get("toIndex")
                if (
                    isinstance(from_index, int)
                    and isinstance(to_index, int)
                    and 0 <= from_index < len(queue)
                    and 0 <= to_index < len(queue)
                ):
                    queue.insert(to_index, queue.pop(from_index))

        for position, item in enumerate(queue):
            connection.execute(
                sa.text(
                    """
                    INSERT INTO jam_room_queue_items
                        (room_id, track_payload, added_by, source, position, created_at)
                    VALUES
                        (:room_id, CAST(:track_payload AS jsonb), :added_by,
                         'legacy', :position, :created_at)
                    """
                ),
                {
                    "room_id": room["id"],
                    "track_payload": json.dumps(item["track"]),
                    "added_by": item["added_by"],
                    "position": position,
                    "created_at": item["created_at"],
                },
            )


def downgrade() -> None:
    op.drop_table("jam_room_queue_votes")
    op.drop_constraint(
        "fk_jam_request_queue_item", "jam_room_track_requests", type_="foreignkey"
    )
    op.drop_table("jam_room_track_requests")
    op.drop_index(
        "idx_jam_room_queue_items_room_status_position",
        table_name="jam_room_queue_items",
    )
    op.drop_table("jam_room_queue_items")
    op.drop_column("jam_rooms", "queue_mode")
