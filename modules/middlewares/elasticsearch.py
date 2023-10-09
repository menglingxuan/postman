# -*- encoding: utf-8 -*-

"""
有两种包：
elasticsearch       —— 提供低级别API
    docs: https://www.elastic.co/guide/en/elasticsearch/client
elasticsearch-dsl   —— 提供高级别API，主要用于查询
    docs：https://elasticsearch-dsl.readthedocs.io/en/latest/index.html
"""


from elasticsearch import Elasticsearch
from .. import (t, e, log, dataclass, field, InitVar,
                ModelCfgType, CfgSectionType, ExecutorAbstract)
from . import PoolManager
from . import OptStr, OptInt, OptBool


class ElasticSearchConfigType(ModelCfgType):
    pass


@dataclass()
class ConnectorConfig(metaclass=ElasticSearchConfigType):
    __parent_path__: InitVar[str]


client = Elasticsearch()
