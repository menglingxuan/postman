# -*- encoding: utf-8 -*-


__all__ = [
    "PoolManager",
    "OptStr",
    "OptInt",
    "OptBool",
    "OptList",
    "OptDict",
    # "OptCls",
    # "OptObj",
    # "OptCall"
]


from abc import ABC, abstractmethod
from typing import Callable


class PoolManager(ABC):

    __pool_managers = dict()

    def __init__(self):
        self._pools = dict()
        self._digests = dict()

    def __del__(self):
        self.teardown_pool()

    @classmethod
    def get(cls):
        return cls.__pool_managers.setdefault(cls.middleware_type, cls())

    def _create_pool(self, server_name, dbconfig):
        self._pools[server_name] = cnx_pool = self.create_pool(server_name, dbconfig)
        return cnx_pool

    def _get_pool(self, server_name, dbconfig, config_digest: int):
        old_digest = self._digests.get(server_name, None)
        pool = self._pools.get(server_name, self._create_pool(server_name, dbconfig))
        if old_digest != config_digest:
            if old_digest is not None:
                self.update_conn_config(pool, dbconfig)
            self._digests[server_name] = config_digest
        return pool

    @classmethod
    @property
    @abstractmethod
    def middleware_type(self):
        raise NotImplementedError

    @abstractmethod
    def create_pool(self, server_name, dbconfig):
        raise NotImplementedError

    @abstractmethod
    def update_conn_config(self, pool, dbconfig):
        raise NotImplementedError

    @abstractmethod
    def teardown_pool(self):
        raise NotImplementedError


from .. import t

OptStr = t.Optional[str]
OptInt = t.Optional[int]
OptBool = t.Optional[bool]
OptList = t.Optional[t.Union[list, tuple]]
OptDict = t.Optional[dict]
# OptCls = t.Optional[type]
# OptObj = t.Optional[object]
# OptCall = t.Optional[Callable]
