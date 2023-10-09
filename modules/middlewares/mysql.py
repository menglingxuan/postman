# -*- encoding: utf-8 -*-


from mysql.connector.pooling import MySQLConnectionPool, PooledMySQLConnection
from mysql.connector.cursor import MySQLCursor, MySQLCursorDict
from mysql.connector.errors import Error as MySQLError
from mysql.connector import errorcode
from itertools import chain

from .. import (e, t, os, log, Any, Union, Path, dataclass, field, InitVar,
                ModelCfgType, CfgSectionType, ExecutorAbstract)
from . import PoolManager
from . import OptStr, OptInt, OptBool, OptList, OptDict


class MySQLConfigType(ModelCfgType):
    pass


@dataclass
class ConnectorConfig(metaclass=MySQLConfigType):
    __parent_path__: InitVar[str]
    # 连接参数文档： https://dev.mysql.com/doc/connector-python/en/connector-python-connectargs.html
    # 屏蔽了部分对本程序而言无实际作用的参数
    user:                       OptStr          = None
    username:                   OptStr          = None   # user 的别名
    password:                   OptStr          = None
    passwd:                     OptStr          = None   # password 的别名
    password1:                  OptStr          = None
    password2:                  OptStr          = None
    password3:                  OptStr          = None
    database:                   OptStr          = None
    db:                         OptStr          = None   # database 的别名
    host:                       OptStr          = None
    port:                       OptInt          = None
    unix_socket:                OptStr          = None
    auth_plugin:                OptStr          = None
    # use_unicode:              OptBool           = None
    charset:                    OptStr          = None
    collation:                  OptStr          = None
    # autocommit:               OptBool           = None
    time_zone:                  OptStr          = None
    sql_mode:                   OptStr          = None
    get_warnings:               OptBool         = None
    raise_on_warnings:          OptBool         = None
    connection_timeout:         OptInt          = None
    connect_timeout:            OptInt          = None    # connection_timeout 的别名
    client_flags:               OptList         = None
    # buffered:                 OptBool           = None
    # raw:                      OptBool           = None
    # consume_results:          OptBool           = None
    tls_versions:               OptList         = None
    ssl_ca:                     OptStr          = None
    ssl_cert:                   OptStr          = None
    ssl_disabled:               OptBool         = None
    ssl_key:                    OptStr          = None
    ssl_verify_cert:            OptBool         = None
    ssl_verify_identity:        OptBool         = None
    force_ipv6:                 OptBool         = None
    oci_config_file:            OptStr          = None
    dsn:                        OptStr          = None
    # pool_name:                OptStr            = None
    pool_size:                  OptInt          = None
    pool_reset_session:         OptBool         = None
    compress:                   OptBool         = None
    # converter_class:          Any               = None
    # converter_str_fallback:   OptBool           = None
    # failover:                 OptList           = None
    option_files:               OptList         = None
    option_groups:              OptList         = None
    # allow_local_infile:       OptBool           = None
    # use_pure:                 OptBool           = None
    krb_service_principal:      OptStr          = None

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


class PoolManager(PoolManager):

    middleware_type = "mysql"

    def create_pool(self, server_name, dbconfig):
        cnx_pool = MySQLConnectionPool(
            pool_name="pool#" + server_name,
            # pool_size = 3,
            # 内部代码其实会尝试先调用 cnx.cmd_reset_connection() 方法，不支持时回滚到 cnx.reset_session()方法
            # pool_reset_session=True,
            **dbconfig
        )
        # 提供了 dbconfig 参数时，显式实例化连接池对象后内部代码其实会立即加满最大数量的连接
        # 因此无需再手动调用 pool.add_connection() 方法，多余的调用反而导致溢出连接池大小从而抛出错误
        return cnx_pool

    def update_conn_config(self, pool, dbconfig):
        pool.set_config(**dbconfig)

    def teardown_pool(self):
        for pool in self._pools.values():
            # 移除连接池中的所有连接，该方法中已包含错误捕获
            pool._remove_connections()


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
    def _execone(cls, connection, statement, query_config: QueryConfig):
        log.info("MySQL: 执行SQL查询：%s", statement)
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
        pool = PoolManager.get()._get_pool(server_tag, dbconfig, config_digest)
        pooled_connection = pool.get_connection()
        # pooled_connection.get_warnings = True
        main_config = MainConfig.get_model_cfg(cfg)
        query_config = QueryConfig.get_model_cfg(main_config)
        results = [self._execone(pooled_connection, statement, query_config)
                   for statement in map(self._restrict_sql, statements)]

        pooled_connection.close()
        return self.output(results)
