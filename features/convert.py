# -*- encoding: utf-8 -*-


__all__ = ["FeatureCls"]


import json

from . import *


@Cfg(is_plain_text=bool)
class FeatureConvert(Feature):
    async def feature_it(self):
        if self.cfg.get("is_plain_text", False):
            return self.set_result(self.data, as_raw=True, is_json=False)
        try:
            json.loads(self.pure_data)
        except json.JSONDecodeError as e:
            if e.msg.startswith("Unexpected UTF-8 BOM"):
                raise e from None
            return self.set_result(self.data, as_raw=True, is_json=False)
        else:
            return self.set_result(self.data, as_raw=True, is_json=True)


FeatureCls = FeatureConvert
