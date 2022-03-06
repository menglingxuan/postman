# -*- encoding: utf-8 -*-


""" 仅通过模块引用变量进行访问"""
__all__ = []


from contextvars import ContextVar, Token

from . import e, sys, Path


_failed_reason = ContextVar("last_false_reason", default="")
_failed_key = ContextVar("last_false_key", default="")


def _restart():
    reason("")
    return True

# TODO: 重写
def reason(msg=None, *, set_key=None, key_info=False, both_info=False, chain_info=False):
    if msg is None:
        if set_key is not None or len(list(filter(None, (key_info, both_info, chain_info)))) > 1:
            raise e.SystemError
        if key_info:
            return _failed_key.get()
        if both_info:
            return _failed_key.get(), _failed_reason.get()
        if chain_info:
            return f"{_failed_key.get()}: {_failed_reason.get()}"
        return _failed_reason.get()
    if set_key is not None:
        token_key: Token = _failed_key.set(set_key)
        token_msg: Token = _failed_reason.set(msg)
        return token_key, token_msg
    token_msg: Token = _failed_reason.set(msg)
    return token_msg


def chain_reason(key, value, typ: type):
    reason_key, inner_reason = reason(both_info=True)
    new_reason = inner_reason if inner_reason != "" else f"目标类型：{typ!s}，实际类型：{type(value)}"
    new_key = f"{key}.{reason_key}" if reason_key != "" else key
    return reason(new_reason, set_key=new_key)


class _T(object):
    __slots__ = ()


class _S(type):
    __slots__ = ()


def _make(typ):
    return typ(typ.__name__, (_T, ), dict(__slots__=()))


def _is_net_complex_t(typ):
    return typ in (str, int, float, bool, dict, list) \
           or issubclass(typ, _T) \
           or isinstance(typ, _S)


class _UnionType(_S):
    def __instancecheck__(self, instance):
        is_bool = isinstance(instance, self.__args__)
        if is_bool:
            _restart()
        return is_bool

    def __repr__(cls):
        return repr(list(cls.__args__))


class Union(object):
    def __class_getitem__(cls, parameters):
        if not isinstance(parameters, tuple) and len(parameters) < 2:
            raise e.SystemError
        arg0 = parameters[0]
        if arg0 is None or not _is_net_complex_t(arg0):
            raise e.SystemError
        for t in parameters[1:]:
            if not isinstance(t, type):
                raise e.SystemError
        return type.__new__(_UnionType, '_Union', (object, ), dict(__args__=parameters))


class Optional(object):
    def __class_getitem__(cls, parameter):
        return Union[parameter, type(None)]


class CommonChecker(object):
    def __init__(self, src_obj, src_attr, fields, keypath):
        self.keypath = keypath
        for k, v in fields.metadata.items():
            userval = getattr(src_obj, src_attr)
            getattr(self, k)(v, userval)

    def min(self, v, userval):
        if isinstance(userval, int) and userval < v:
            raise e.FeatureError(f"{self.keypath}：最小可配置值：{v}，当前值：{userval!s}")

    def max(self, v, userval):
        if isinstance(userval, int) and userval > v:
            raise e.FeatureError(f"{self.keypath}：最大可配置值：{v}，当前值：{userval!s}")

    def enum(self, v, userval):
        if not isinstance(userval, (str, int, float)): return
        if userval not in v:
            raise e.FeatureError(f"{self.keypath}：可接受的值：[ {', '.join(list(v))} ]，当前值：{userval!s}")

    def allow_empty(self, v, userval):
        if v: return
        if isinstance(userval, str):
            if not userval.strip():
                raise e.FeatureError(f"{self.keypath}：不允许为空，当前值：\"{userval}\"")
        if isinstance(userval, (int, float)):
            if userval == 0:
                raise e.FeatureError(f"{self.keypath}：不允许为零，当前值：{userval!s}")
        if isinstance(userval, (list, tuple, dict)):
            if len(userval) == 0:
                raise e.FeatureError(f"{self.keypath}：不允许为空，当前值：{userval!s}")

    def is_file(self, v, userval):
        if not isinstance(userval, str): return
        try:
            path = Path(userval)
        except Exception:
            raise e.FeatureError(f"{self.keypath}：不是有效的文件路径格式，当前值：\"{userval}\"")
        is_file = path.exists() and path.is_file()
        if v:
            if not is_file:
                raise e.FeatureError(f"{self.keypath}：文件路径不存在，当前值：\"{userval}\"")
        if is_file:
            raise e.FeatureError(f"{self.keypath}：不能是现有的文件路径，当前值：\"{userval}\"")

    def is_dir(self, v, userval):
        if not isinstance(userval, str): return
        try:
            path = Path(userval)
        except Exception:
            raise e.FeatureError(f"{self.keypath}：不是有效的目录路径格式，当前值：\"{userval}\"")
        is_dir = path.exists() and path.is_dir()
        if v:
            if not is_dir:
                raise e.FeatureError(f"{self.keypath}：目录路径不存在，当前值：\"{userval}\"")
        if is_dir:
            raise e.FeatureError(f"{self.keypath}：不能是现有的目录路径，当前值：\"{userval}\"")


# eg: 定义自定义检查类型
# @_make
# class xxx_name():
#     def __instancecheck__(self, instance):
#         e.reason("xxx")
#         return isinstance(xxx, type) and _restart()
