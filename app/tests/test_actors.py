def test_registered_actors_keep_configured_priority():
    from crate import actors

    for task_type, config in actors.TASK_POOL_CONFIG.items():
        priority = config.priority
        actor = actors.get_actor(task_type)

        assert actor is not None
        assert actor.priority == priority


def test_enrich_mbids_is_resource_governed_but_not_db_heavy():
    from crate import actors
    from crate import resource_governor
    from crate.db.repositories import tasks_shared

    assert "enrich_mbids" in resource_governor.RESOURCE_GOVERNED_TASK_TYPES
    assert "enrich_mbids" not in actors.DB_HEAVY_TASK_TYPES
    assert "enrich_mbids" not in tasks_shared.DB_HEAVY_TASKS


def test_download_slot_acquire_is_atomic_and_capacity_bound(monkeypatch):
    from crate import actors

    class FakeRedis:
        def __init__(self):
            self.members: set[str] = set()
            self.expire_calls: list[tuple[str, int]] = []

        def eval(self, _script, _num_keys, key, task_id, max_slots, ttl):
            if task_id in self.members:
                self.expire_calls.append((key, int(ttl)))
                return 1
            if len(self.members) < int(max_slots):
                self.members.add(task_id)
                self.expire_calls.append((key, int(ttl)))
                return 1
            return 0

    redis = FakeRedis()
    monkeypatch.setattr(actors, "DOWNLOAD_SEM_MAX", 1)

    assert actors._try_acquire_download_slot(redis, "task-1") is True
    assert actors._try_acquire_download_slot(redis, "task-2") is False
    assert actors._try_acquire_download_slot(redis, "task-1") is True
    assert redis.members == {"task-1"}
    assert redis.expire_calls == [
        (actors._DOWNLOAD_SEM_KEY, actors.DOWNLOAD_SEM_TTL_SECONDS),
        (actors._DOWNLOAD_SEM_KEY, actors.DOWNLOAD_SEM_TTL_SECONDS),
    ]
