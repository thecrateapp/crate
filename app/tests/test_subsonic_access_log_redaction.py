import logging
from io import StringIO

from crate.observability.access_log import (
    OpenSubsonicAccessLogFilter,
    install_open_subsonic_access_log_filter,
)


def test_uvicorn_access_logger_redacts_opensubsonic_credentials():
    logger = logging.getLogger("uvicorn.access")
    stream = StringIO()
    handler = logging.StreamHandler(stream)
    previous_level = logger.level
    logger.setLevel(logging.INFO)
    logger.addHandler(handler)
    try:
        install_open_subsonic_access_log_filter(logger)
        install_open_subsonic_access_log_filter(logger)
        logger.info(
            '%s - "%s %s HTTP/%s" %d',
            "127.0.0.1:54321",
            "GET",
            "/rest/ping?u=listener&p=plain&T=challenge&S=salt&apiKey=secret&c=feishin",
            "1.1",
            200,
        )
        message = stream.getvalue()
    finally:
        logger.removeHandler(handler)
        logger.setLevel(previous_level)

    assert "/rest/ping?u=listener&p=[Filtered]" in message
    assert "T=[Filtered]" in message
    assert "S=[Filtered]" in message
    assert "apiKey=[Filtered]" in message
    assert "listener" in message
    assert "feishin" in message
    assert "plain" not in message
    assert "challenge" not in message
    assert "salt" not in message
    assert "secret" not in message
    assert (
        sum(isinstance(item, OpenSubsonicAccessLogFilter) for item in logger.filters)
        == 1
    )


def test_access_filter_leaves_non_subsonic_routes_unchanged():
    record = logging.LogRecord(
        name="uvicorn.access",
        level=logging.INFO,
        pathname="uvicorn/protocols/http/h11_impl.py",
        lineno=1,
        msg='%s - "%s %s HTTP/%s" %d',
        args=("127.0.0.1:54321", "GET", "/api/search?p=2", "1.1", 200),
        exc_info=None,
    )

    OpenSubsonicAccessLogFilter().filter(record)

    assert "p=2" in record.getMessage()


def test_application_factory_installs_access_filter(test_app):
    del test_app

    logger = logging.getLogger("uvicorn.access")

    assert any(isinstance(item, OpenSubsonicAccessLogFilter) for item in logger.filters)
