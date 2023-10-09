# -*- encoding: utf-8 -*-


from redis import ConnectionPool, Redis, RedisError
from argparse import ArgumentParser, ArgumentError
from .. import (t, e, log, dataclass, field, InitVar,
                ModelCfgType, CfgSectionType, ExecutorAbstract)
from . import PoolManager
from . import OptStr, OptInt, OptBool, OptList, OptDict


class RedisConfigType(ModelCfgType):
    pass


@dataclass()
class ConnectorConfig(metaclass=RedisConfigType):
    __parent_path__: InitVar[str]
    # https://github.com/redis/redis-py
    host:                       OptStr          = None
    port:                       OptInt          = None
    db:                         OptStr          = None
    password:                   OptStr          = None
    socket_timeout:             OptInt          = None
    socket_connect_timeout:     OptInt          = None
    socket_keepalive:           OptBool         = None
    socket_keepalive_options:   OptDict         = None
    # connection_pool:          OptStr            = None
    unix_socket_path:           OptStr          = None
    # encoding:                 OptStr            = None
    # encoding_errors:          OptStr            = None
    # charset:                  OptStr            = None
    # errors:                   OptStr            = None
    decode_responses:           OptBool         = None
    retry_on_timeout:           OptBool         = None
    ssl:                        OptBool         = None
    ssl_keyfile:                OptStr          = None
    ssl_certfile:               OptStr          = None
    ssl_cert_reqs:              OptStr          = None
    ssl_ca_certs:               OptStr          = None
    ssl_check_hostname:         OptBool         = None
    max_connections:            OptInt          = None
    single_connection_client:   OptBool         = None
    health_check_interval:      OptInt          = None
    client_name:                OptStr          = None
    username:                   OptStr          = None

    @classmethod
    @property
    def __doc__(cls):
        return f"""
        123
"""


@dataclass()
class QueryConfig(metaclass=CfgSectionType):
    __parent_path__: InitVar[str]

    __doc__ = f"""
    456
"""


@dataclass()
class MainConfig(metaclass=CfgSectionType):
    __parent_path__: InitVar[str]
    query: QueryConfig

    __doc__ = f"""
    789
"""


class PoolManager(PoolManager):

    middleware_type = "redis"

    def create_pool(self, server_tag, dbconfig):
        # redis.Redis() 已经默认 encoding="utf-8", encoding_errors="strict"
        # 这里使用系统默认值即可，没必要作为用户参数
        return ConnectionPool(**dbconfig)

    def update_conn_config(self, pool, dbconfig):
        pass

    def teardown_pool(self):
        for pool in self._pools.values():
            try:
                pool.disconnect()
            except:
                pass


class _CommandParser(ArgumentParser):
    pass


class Executor(ExecutorAbstract):
    @staticmethod
    def _restrict_sql(sql):
        return sql

    @staticmethod
    def _restrict_result(*args):
        return

    @classmethod
    def _execute_one(cls, connection: Redis, statement, query_config: QueryConfig):
        log.info("Redis: 执行SQL查询：%s", statement)
        result: bytes = connection.get("test")
        return result.decode()

    @staticmethod
    def output(multi_results):
        data = multi_results[0]
        warnings = []
        return data, warnings

    async def execute(self, statements: list, cfg: ConnectorConfig):
        dbconfig = ConnectorConfig.get_model_cfg(cfg)
        config_digest: int = hash(str(dbconfig))
        host, port, socket, db = dbconfig.getmany(
            ("host", "port", "unix_socket", "db"), ("localhost", 6379, "", 0))
        server_tag = f"{host}#{port}#{socket}#{db}"
        pool: ConnectionPool = PoolManager.get()._get_pool(server_tag, dbconfig, config_digest)
        pooled_connection: Redis = Redis(connection_pool=pool)
        main_config = MainConfig.get_model_cfg(cfg)
        query_config = QueryConfig.get_model_cfg(main_config)
        results = [self._execute_one(pooled_connection, statement, query_config)
                   for statement in map(self._restrict_sql, statements)]
        pooled_connection.close()
        return self.output(results)
