from crate.db.engine import reset_engine


def reset_database_runtime_after_fork() -> None:
    reset_engine()


__all__ = ["reset_database_runtime_after_fork"]
