"""
Regression test for the "Received unregistered task of type 'process_contract'"
bug: celery_app.py used to call autodiscover_tasks(["app.tasks"]), which only
imports a submodule literally named `tasks.py` inside a package — a
Django-ism — so it never loaded app/tasks/pipeline.py and the worker process
never registered `process_contract`. Fixed by passing
include=["app.tasks.pipeline"] to the Celery() constructor instead.

This test imports celery_app fresh (no app.tasks.pipeline import anywhere
else in this module) and asserts the task is present in celery_app.tasks —
exactly the check a real `celery -A app.celery_app worker` process does on
startup. If this regresses back to autodiscover_tasks, this test fails.
"""


def test_process_contract_is_registered():
    from app.celery_app import celery_app

    assert "process_contract" in celery_app.tasks, (
        "process_contract is not registered on the Celery app — this is the "
        "exact bug that caused 'Received unregistered task of type "
        "process_contract'. Check that celery_app.py uses "
        "include=['app.tasks.pipeline'], not autodiscover_tasks(['app.tasks'])."
    )


def test_process_contract_task_retry_config():
    from app.celery_app import celery_app

    task = celery_app.tasks["process_contract"]
    assert task.max_retries == 2
    assert task.default_retry_delay == 30
