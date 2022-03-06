# -*- encoding: utf-8 -*-


__all__ = [
    "ConnectorConfig"
]


from mysql.connector.pooling import MySQLConnectionPool
from mysql.connector.cursor import MySQLCursor, MySQLCursorDict
from mysql.connector.errors import Error as MySQLError
from mysql.connector import errorcode
from itertools import chain

from .. import (e, t, os, log, Any, Union, Path, dataclass, field, InitVar,
                ModelCfgType, CfgSectionType, ExecutorAbstract)


T = t.Optional[str]
S = t.Optional[int]
U = t.Optional[bool]
V = t.Optional[t.Union[list, tuple]]


class MySQLConfigType(ModelCfgType):
    pass


@dataclass
class ConnectorConfig(metaclass=MySQLConfigType):
    __parent_path__: InitVar[str]
    # 连接参数文档： https://dev.mysql.com/doc/connector-python/en/connector-python-connectargs.html
    # 屏蔽了部分对本程序而言无实际作用的参数
    user: T                     = None
    username: T                 = None   # user 的别名
    password: T                 = None
    passwd: T                   = None   # password 的别名
    password1: T                = None
    password2: T                = None
    password3: T                = None
    database: T                 = None
    db: T                       = None   # database 的别名
    host: T                     = None
    port: S                     = None
    unix_socket: T              = None
    auth_plugin: T              = None
    # use_unicode: U            = None
    charset: T                  = None
    collation: T                = None
    # autocommit: U             = None
    time_zone: T                = None
    sql_mode: T                 = None
    get_warnings: U             = None
    raise_on_warnings: U        = None
    connection_timeout: S       = None
    connect_timeout: S          = None    # connection_timeout 的别名
    client_flags: V             = None
    # buffered: U               = None
    # raw: U                    = None
    # consume_results: U        = None
    tls_versions: V             = None
    ssl_ca: T                   = None
    ssl_cert: T                 = None
    ssl_disabled: U             = None
    ssl_key: T                  = None
    ssl_verify_cert: U          = None
    ssl_verify_identity: U      = None
    force_ipv6: U               = None
    oci_config_file: T          = None
    dsn: T                      = None
    # pool_name: T                = None
    pool_size: S                = None
    pool_reset_session: U       = None
    compress: U                 = None
    # converter_class: Any      = None
    # converter_str_fallback: U = None
    # failover: V               = None
    option_files: V             = None
    option_groups: V            = None
    # allow_local_infile: U       = None
    # use_pure: U                 = None
    krb_service_principal: T    = None

    """ ***.keys()][1:]: 移除 __parent_path__ 属性 """
    @classmethod
    @property
    def __doc__(cls):
        return f"""
    关于以下参数的具体信息，参考：https://dev.mysql.com/doc/connector-python/en/connector-python-connectargs.html
    ======================
    支持配置的参数（并非所有参数都经过测试）：
        , {(os.linesep + "        , ").join([*cls.__annotations__.keys()][1:])}
    ======================
    以下参数被认为不适用本程序，因此不支持配置：
        , use_unicode
        , autocommit
        , buffered
        , raw
        , consume_results
        , pool_name
        , converter_class
        , converter_str_fallback
        , failover
        , allow_local_infile
        , use_pure
"""

@dataclass
class QueryConfig(metaclass=CfgSectionType):
    __parent_path__: InitVar[str]
    maxRowsLimited: int = field(metadata=dict(min=1, max=20))

    __doc__ = f"""
    支持配置的参数
        , maxRowsLimited=       [required,int,{{min=1,max=20}}]
"""


@dataclass
class MainConfig(metaclass=CfgSectionType):
    __parent_path__: InitVar[str]
    query: QueryConfig

    __doc__ = f"""
    支持配置的参数
        , query=  [required,dict]
"""


# singleton class
class _MySQLConnectionPools():
    _pools = dict()
    _digests = dict()

    @classmethod
    def _create_pool(cls, server_name, dbconfig):
        cnx_pool = MySQLConnectionPool(
            pool_name = "pool#" + server_name,
            # pool_size = 3,
            # 内部代码其实会尝试先调用 cnx.cmd_reset_connection() 方法，不支持时回滚到 cnx.reset_session()方法
            # pool_reset_session=True,
            **dbconfig
        )
        # 提供了 dbconfig 参数时，显式实例化连接池对象后内部代码其实会立即加满最大数量的连接
        # 因此无需再手动调用 pool.add_connection() 方法，多余的调用反而导致溢出连接池大小从而抛出错误
        cls._pools[server_name] = cnx_pool
        return cnx_pool

    @classmethod
    def get_pool(cls, server_name, dbconfig, config_digest: int):
        old_digest = cls._digests.get(server_name, None)
        pool: MySQLConnectionPool = cls._pools.get(server_name,
                                                    cls._create_pool(server_name, dbconfig))
        if old_digest != config_digest:
            if old_digest is not None:
                pool.set_config(**dbconfig)
            cls._digests[server_name] = config_digest
        return pool


_support_statements = (
    "help",
    "show",
    "desc",
    "with",
    "select",
    "explain"
)


class Executor(ExecutorAbstract):
    @staticmethod
    def _restrict_sql(sql):
        first_keyword = sql.split()[0]
        if first_keyword.isalpha():
            if first_keyword.lower() in _support_statements:
                return sql
        raise e.FeatureError(f"仅支持以下MySQL语句：{_support_statements!s}，实际执行语句：{sql}")

    @staticmethod
    def _restrict_result(cursor, statement, query_config):
        row_num, column_num = cursor.rowcount, len(cursor.column_names)
        if row_num == 0:
            raise e.FeatureError(f"SQL语句执行成功但查询结果为空：{statement}")
        if column_num > 1 and row_num != 1:
            raise e.FeatureError(f"查询结果返回多列时，仅支持返回一行数据，当前返回 {row_num} 行：{statement}")
        max_rows_limited, larger_max_rows_limitd = query_config.getmany(
            ["maxRowsLimited", "largerMaxRowsLimited"], [20, 50])
        if row_num > max_rows_limited:
            raise e.FeatureError(f"支持返回单列至多 {max_rows_limited} 行数据，当前返回 {row_num} 行：{statement}")
        return

    @classmethod
    def _execone(cls, connection, statement, query_config):
        log.info("执行SQL查询：%s", statement)
        cursor: MySQLCursor = connection.cursor()
        cnx_interruped = False
        try:
            # multi=False 时应确保只执行单个语句，多个语句似乎会导致内部发生错误(代码不抛出错误)从而导致连接提前关闭
            # 最好使用赋值表达式，尽管在 multi=False 时返回 None，因为不赋值的话可能导致未读取的数据
            _ = cursor.execute(statement, params=None, multi=False)
            if cursor.with_rows:
                warnings = None
                rows = cursor.fetchall()
                if not connection._cnx.is_connected():
                    cnx_interruped = True
                    # 因为没有太好的方法判断是否多个语句，因此暂用该方法判断
                    # 也可能存在其他原因导致连接被提前关闭，因此该判断方法并不严谨
                    # 如果不提前处理连接被提前关闭的情况，会导致后面 cnx.close() 方法调用报错，因为连接已丢失
                    raise e.FeatureError(f"请确保每个任务仅执行单个SQL语句：{statement}")
                cls._restrict_result(cursor, statement, query_config)
                # 获取与语句有关的警告信息
                if connection.get_warnings:
                    warnings = cursor.fetchwarnings()
                cursor.close()
                return dict(columns=cursor.column_names, rows=rows, warnings=warnings or [])
            raise e.FeatureError(f"不支持无法产生结果集的SQL语句类型：{statement}")
        except MySQLError as err:
            cursor.close()
            if not cnx_interruped:
                connection.close()
            raise err

    @staticmethod
    def output(multi_results):
        rows = multi_results[0]["rows"]
        warnings = multi_results[0]["warnings"]
        data = [x for x in chain.from_iterable(rows)]
        return ",".join(data), warnings

    async def execute(self, statements: list, cfg: ConnectorConfig):
        dbconfig = ConnectorConfig.get_model_cfg(cfg)
        config_digest: int = hash(str(dbconfig))
        host, port, socket = dbconfig.getmany(("host", "port", "unix_socket"), ("127.0.0.1", 3306, ""))
        server_tag = f"{host}#{port}#{socket}"
        pool = _MySQLConnectionPools.get_pool(server_tag, dbconfig, config_digest)
        pooled_connection = pool.get_connection()
        # pooled_connection.get_warnings = True
        main_config = MainConfig.get_model_cfg(cfg)
        query_config = QueryConfig.get_model_cfg(main_config)
        results = [self._execone(pooled_connection, statement, query_config)
                   for statement in map(self._restrict_sql, statements)]

        pooled_connection.close()
        return self.output(results)
