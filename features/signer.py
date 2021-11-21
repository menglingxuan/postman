# -*- encoding: utf-8 -*-


__all__ = ["FeatureCls"]


from . import *


@Cfg(lang=str, executor=ExecutorConfig)
class FeatureSigner(Feature):
    async def feature_it(self):
        code, cfg = (self.data, self.cfg)
        executor = Executor()
        result = await executor.exec(code, cfg)
        return self.set_result(result)


FeatureCls = FeatureSigner
