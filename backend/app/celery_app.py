from celery import Celery

from app.core.config import settings

celery_app = Celery(
    "clauseiq",
    broker=settings.CELERY_BROKER_URL,
    backend=settings.CELERY_RESULT_BACKEND,
    # Explicit module list, not autodiscover_tasks(["app.tasks"]) — that helper
    # only imports a submodule literally named `tasks.py` inside each package
    # (a Django-ism), so it silently never loaded app/tasks/pipeline.py and the
    # worker process never registered `process_contract`. `include` is the
    # correct mechanism for a plain (non-Django) Celery app: it forces the
    # worker to import these modules on startup, which is what actually
    # registers the @celery_app.task-decorated functions inside them.
    include=["app.tasks.pipeline"],
)

celery_app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    task_track_started=True,
    task_acks_late=True,
    worker_prefetch_multiplier=1,  # OCR/LLM tasks are slow — don't hog the queue
    task_time_limit=600,
    task_soft_time_limit=540,
)

