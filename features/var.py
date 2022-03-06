# -*- encoding: utf-8 -*-


__all__ = ["FeatureCls"]


from . import *


@Cfg(lang=str, executor=ExecutorConfig, middleware=MiddlewareConfig)
class FeatureVar(Feature):
    async def feature_it(self):
        code, cfg = (self.data, self.cfg)
        executor = Executor()
        result, warnings = await executor.execute(code, cfg)
        return self.set_result(result, warnings=warnings)


FeatureCls = FeatureVar
