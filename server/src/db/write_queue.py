import asyncio
import logging
from typing import Any, Callable

logger = logging.getLogger(__name__)


class AsyncWriteQueue:
    def __init__(self) -> None:
        self._queue: "asyncio.Queue[tuple]" = asyncio.Queue()
        self._worker_task: asyncio.Task | None = None

    async def _worker(self) -> None:
        while True:
            fut, func, args, kwargs = await self._queue.get()
            try:
                # If coroutine function, await it; otherwise run in executor
                if asyncio.iscoroutinefunction(func):
                    res = await func(*args, **kwargs)
                else:
                    loop = asyncio.get_event_loop()
                    res = await loop.run_in_executor(None, lambda: func(*args, **kwargs))
                if not fut.done():
                    fut.set_result(res)
            except Exception as e:
                logger.exception("Write queue task failed: %s", e)
                if not fut.done():
                    fut.set_exception(e)
            finally:
                try:
                    self._queue.task_done()
                except Exception:
                    pass

    def _ensure_worker(self) -> None:
        if self._worker_task is None:
            try:
                loop = asyncio.get_event_loop()
                # create background worker
                self._worker_task = loop.create_task(self._worker())
            except RuntimeError:
                # No running loop; defer worker creation until enqueue is awaited
                self._worker_task = None

    async def enqueue(self, coro_func: Callable[..., Any], *args, **kwargs) -> Any:
        """Enqueue a coroutine function for serialized execution and await its result."""
        loop = asyncio.get_event_loop()
        fut = loop.create_future()
        # ensure background worker exists
        if self._worker_task is None:
            self._ensure_worker()
            # if still None, start worker synchronously
            if self._worker_task is None:
                # schedule worker on loop
                self._worker_task = loop.create_task(self._worker())

        await self._queue.put((fut, coro_func, args, kwargs))
        return await fut


# Singleton instance
write_queue = AsyncWriteQueue()


