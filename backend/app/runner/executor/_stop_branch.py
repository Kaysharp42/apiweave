"""Internal sentinel exception for stopping a branch."""


class _StopBranch(BaseException):
    """Internal sentinel to stop a branch when ``continue_on_fail=False``.

    Inherits from :class:`BaseException` (not :class:`Exception`) so it
    bypasses the ``except Exception:`` handlers in the executor.  We do NOT
    use :class:`StopIteration` for this purpose — since Python 3.7 a
    coroutine that raises ``StopIteration`` triggers PEP 479 and surfaces
    as ``RuntimeError: coroutine raised StopIteration``, which asyncio
    then reports to the caller as a failed task.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)
        self.message = message
