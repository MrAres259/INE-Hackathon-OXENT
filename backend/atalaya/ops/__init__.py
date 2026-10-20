"""ATALAYA operations and supervision tools."""

__all__ = ["ServiceSpec", "Supervisor"]


def __getattr__(name: str):
    if name in ("ServiceSpec", "Supervisor"):
        from atalaya.ops.supervisor import ServiceSpec, Supervisor

        return {"ServiceSpec": ServiceSpec, "Supervisor": Supervisor}[name]
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")
