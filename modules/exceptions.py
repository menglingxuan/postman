# -*- encoding: utf-8 -*-


__all__ = [
    "SystemError",
    "FeatureError",
    "FeatureWarning"
]


class SystemError(Exception):
    def __init__(self):
        self.args = ("系统错误", )


class FeatureError(Exception):
    pass


class FeatureWarning(UserWarning):
    pass
