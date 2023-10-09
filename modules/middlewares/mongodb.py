# -*- encoding: utf-8 -*-


from pymongo.mongo_client import MongoClient
from pymongo.server_api import ServerApi
from pymongo.errors import PyMongoError
from .. import (t, e, log, json, dataclass, field, InitVar,
                ModelCfgType, CfgSectionType, ExecutorAbstract)
from . import PoolManager
from . import (OptStr, OptInt, OptBool, OptList, OptDict)
# from . import (OptCls, OptObj, OptCall)


class MongoConfigType(ModelCfgType):
    pass


@dataclass()
class ConnectorConfig(metaclass=MongoConfigType):
    __parent_path__: InitVar[str]

    """ -------------------------- ---------------
    以下所有参数的具体说明详见 MongoClient docstring  
    ------------------------------------------ """

    """ 以下参数支持直接在 URI 中指定，若同时在 kwargs 中指定，则后者覆盖前者 """
    host: OptStr                                  = None
    port: OptInt                                  = None
    # document_class: OptCls        = None
    tz_aware: OptBool                             = None
    connect: OptBool                              = None
    # type_registry: OptObj       = None

    """ -------------------------- 
    以下参数仅支持通过 kwargs 传递 
    -------------------------- """

    directConnection: OptBool                     = None
    maxPoolSize: OptInt                           = None
    minPoolSize: OptInt                           = None
    maxIdleTimeMS: OptInt                         = None
    maxConnecting: OptInt                         = None
    socketTimeoutMS: OptInt                       = None
    connectTimeoutMS: OptInt                      = None
    # server_selector: OptCall                      = None
    serverSelectionTimeoutMS: OptInt              = None
    waitQueueTimeoutMS: OptInt                    = None
    heartbeatFrequencyMS: OptInt                  = None
    appname: OptStr                               = None
    # driver: OptCls                                = None
    # event_listeners: OptList                      = None
    retryWrites: OptBool                          = None
    retryReads: OptBool                           = None
    compressors: OptStr                           = None
    zlibCompressionLevel: OptInt                  = None
    uuidRepresentation: OptStr                    = None
    unicode_decode_error_handler: OptStr          = None
    srvServiceName: OptStr                        = None

    """ Write Concern """
    w: t.Optional[t.Union[int, str]]              = None
    wTimeoutMS: OptInt                            = None
    journal: OptBool                              = None
    fsync: OptBool                                = None

    """ Replica Set """
    replicaSet: OptStr                            = None

    """ Replica Set Read Preference """
    readPreference: OptStr                        = None
    readPreferenceTags: OptStr                    = None
    maxStalenessSeconds: OptInt                   = None

    """ Authentication """
    username: OptStr                              = None
    password: OptStr                              = None
    authSource: OptStr                            = None
    authMechanism: OptStr                         = None
    authMechanismProperties: OptStr               = None

    """ TLS/SSL """
    tls: OptBool                                  = None
    tlsInsecure: OptBool                          = None
    tlsAllowInvalidCertificates: OptBool          = None
    tlsAllowInvalidHostnames: OptBool             = None
    tlsCAFile: OptStr                             = None
    tlsCertificateKeyFile: OptStr                 = None
    tlsCRLFile: OptStr                            = None
    tlsCertificateKeyFilePassword: OptStr         = None
    tlsDisableOCSPEndpointCheck: OptBool          = None
    ssl: OptBool                                  = None

    """ Read Concern """
    readConcernLevel: OptStr                      = None

    """ Client side encryption """
    # auto_encryption_opts: OptCls  = None

    """ Versioned API """
    # server_api: OptCls            = None

    """ -----------------------------
    End          End         End
    ----------------------------- """

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

    middleware_type = "mongodb"

    def create_pool(self, server_tag, dbconfig):
        return MongoClient(**dbconfig)

    def update_conn_config(self, pool, dbconfig):
        pass

    def teardown_pool(self):
        for pool in self._pools.values():
            try:
                pool.close()
            except:
                pass


class Executor(ExecutorAbstract):
    @staticmethod
    def _restrict_sql(sql):
        return sql

    @staticmethod
    def _restrict_result(*args):
        return

    @classmethod
    def _execute_one(cls, connection, statement, query_config: QueryConfig):
        log.info("MongoDB: 执行SQL查询：%s", statement)
        client = connection
        db = client.test
        result: dict = db.books.find_one()
        return json.dumps(result)

    @staticmethod
    def output(multi_results):
        result = multi_results[0]
        warnings = []
        return result, warnings

    async def execute(self, statements: list, cfg: ConnectorConfig):
        dbconfig = ConnectorConfig.get_model_cfg(cfg)
        config_digest: int = hash(str(dbconfig))
        host, port = dbconfig.getmany(("host", "port"), ("localhost", 27017))
        server_tag = f"{host}#{port}"
        pool = PoolManager.get()._get_pool(server_tag, dbconfig, config_digest)
        pooled_connection = pool
        main_config = MainConfig.get_model_cfg(cfg)
        query_config = QueryConfig.get_model_cfg(main_config)
        results = [self._execute_one(pooled_connection, statement, query_config)
                   for statement in map(self._restrict_sql, statements)]
        pooled_connection.close()
        return self.output(results)
