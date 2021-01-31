# -*- encoding: utf-8 -*-


__all__ = [
    "FeatureConvert"
]


import json

from . import *


class FeatureConvert(Feature):
    async def feature(self):
        self.data = self.data.strip()
        try:
            json.loads(self.data)
        except:
            return text_response(text=self.data)
        else:
            return json_response(text=self.data)


FeatureCls = FeatureConvert
