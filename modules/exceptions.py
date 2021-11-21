# -*- encoding: utf-8 -*-
"""
    InternalError
        DefinitionError
        ParamError
    FeatureError
        ExecutorError
            GuessError
    FeatureWarning
        ExecutorWarning
"""


from .doc import DocMixIn


class InternalError(Exception, DocMixIn):
    def __init__(self):
        self.args = ("内部错误", )


class DefinitionError(InternalError):
    def __init__(self):
        self.args = ("定义错误", )


class ParamError(InternalError):
    def __init__(self):
        self.args = ("传参错误", )


class FeatureError(Exception, DocMixIn):
    pass


class ExecutorError(FeatureError):
    pass


class GuessError(FeatureError):
    pass


class FeatureWarning(UserWarning):
    pass


class ExecutorWarning(FeatureWarning):
    pass


__all__ = list(globals().keys())
