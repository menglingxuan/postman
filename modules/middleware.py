# -*- encoding: utf-8 -*-

__all__ = [
    "support_middlewares",
    "MiddlewareConfig"
]


from . import (e, t, log, sys, dataclass, InitVar, dataclasses,
               import_module, FeatureCfg, ModelCfgType, make_lazy_type)


support_middlewares = (
    "mysql",
    "redis",
    "mongodb",
    "elasticsearch",
    # 别名
    "sql",      # alias 'mysql'
    "mongo",    # alias 'mongodb'
    "elastic"   # alias 'elasticsearch'
)


class MiddlewareCfgType(ModelCfgType):
    pass


@dataclass()
class MiddlewareConfig(metaclass=MiddlewareCfgType):
    __parent_path__: InitVar[str]
    lang: str = dataclasses.field(metadata=dict(enum=support_middlewares))
    connector: make_lazy_type("ConnectorConfig")
    main: make_lazy_type("MainConfig")
    mainExtras: t.Optional[make_lazy_type("MainConfig")] = dataclasses.field(default_factory=dict)

    __doc__ = f"""
  支持配置的对象：
      , connector=  [required,dict],
      , main=       [required,dict],
  ================
  以下参数为脚本动态参数，而非 postman.settings 配置项
      , mainExtras= [optional,dict,default=dict]
"""


async def query(type, query, cfg: FeatureCfg):
    target_module = f"{__package__}.middlewares.{type}"
    if target_module in sys.modules:
        module = sys.modules[target_module]
    else:
        module = import_module(f".middlewares.{type}", __package__)
    executor = module.Executor(type)
    executor_cfg: FeatureCfg = MiddlewareConfig.get_model_cfg(cfg,
                                                             lazy_module_name=type,
                                                             lazy_module_abspath=target_module)
    return await executor.execute([query], executor_cfg)
