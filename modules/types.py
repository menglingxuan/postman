# -*- encoding: utf-8 -*-


""" 仅通过模块的变量引用进行访问"""
__all__ = []


from pathlib import Path
from contextvars import ContextVar, Token

from . import e


_failed_reason = ContextVar("last_false_reason", default="")
_failed_key = ContextVar("last_false_key", default="")


def __getattr__(name):
    # namespace = globals()
    # if f"_{name}" in namespace:
    #     if issubclass(namespace[f"{name}"], type):
    #         return namespace[name](name, (_T, ), dict(__slots__=())
    raise AttributeError(f"module '{__name__}' has no exposed attribute named '{name}'")


def _restart():
    reason("")
    return True


class _T(object):
    __slots__ = ()


def _make(typ):
    return typ(typ.__name__, (_T, ), dict(__slots__=()))


def is_t(typ):
    return isinstance(typ, type) and issubclass(typ, _T)


def reason(msg=None, *, set_key=None, key_info=False, both_info=False, chain_info=False):
    if msg is None:
        if set_key is not None or len(list(filter(None, (key_info, both_info, chain_info)))) > 1:
            raise e.ParamError()
        if key_info:
            return _failed_key.get()
        if both_info:
            return _failed_key.get(), _failed_reason.get()
        if chain_info:
            return f"\"{_failed_key.get()}\": {_failed_reason.get()}"
        return _failed_reason.get()
    if set_key is not None:
        token_key: Token = _failed_key.set(set_key)
        token_msg: Token = _failed_reason.set(msg)
        return token_key, token_msg
    token_msg: Token = _failed_reason.set(msg)
    return token_msg


def chain_reason(key, value, typ: type):
    reason_key, inner_reason = reason(both_info=True)
    new_reason = inner_reason if inner_reason != "" else f"目标类型：{typ!s}，实际传值类型：{type(value)}"
    new_key = f"{key}.{reason_key}" if reason_key != "" else key
    return reason(new_reason, set_key=new_key)


class _UnionType(type):
    def __instancecheck__(self, instance):
        args = list(getattr(self, "__args__"))
        if args[0] is None: args[0] = type(None)
        if args[1] is None: args[1] = type(None)
        return isinstance(instance, tuple(args))


class Union(object):
    """ 用以支持定义默认值时此默认值的类型"""
    def __class_getitem__(cls, parameters):
        if (not isinstance(parameters, tuple)) or len(parameters) != 2:
            raise e.DefinitionError()
        if parameters[0] is parameters[1]:
            raise e.DefinitionError()
        a = parameters[0] in (str, int, float, bool, None) or is_t(parameters[0])
        b = parameters[1] in (str, int, float, bool, None) or is_t(parameters[1])
        if not any((a, b)):
            raise e.DefinitionError()
        return _UnionType('_UnionType', (object, ), dict(__args__=parameters))


class Optional(object):
    """  用以支持定义默认值时此默认值的类型"""
    def __class_getitem__(cls, parameter):
        if not is_t(parameter) and parameter not in (str, int, float, bool):
            raise e.DefinitionError()
        return Union[parameter, None]


@_make
class none_empty_str(type):
    def __instancecheck__(self, instance):
        reason("不是字符串类型或为空")
        return isinstance(instance, str) and len(instance.strip()) > 0 and _restart()


@_make
class may_empty_str(type):
    def __instancecheck__(self, instance):
        reason("不是字符串类型")
        return isinstance(instance, str) and _restart()


@_make
class executor_supports_lang(type):
    def __instancecheck__(self, instance):
        from . import get_supports_lang
        supports_lang = get_supports_lang()
        reason(f"不支持的语言：\"{instance!s}\"。支持的语言：{supports_lang!s}")
        return isinstance(instance, str) and instance in supports_lang and _restart()


@_make
class timeout_in_seconds(type):
    def __instancecheck__(self, instance):
        reason("不是超时秒数")
        return isinstance(instance, int) and instance >= 0 and _restart()


@_make
class dirpath(type):
    def __instancecheck__(self, instance):
        path = Path(instance)
        reason(f"目录不存在: {path!s}")
        return isinstance(instance, str) and path.exists() and path.is_dir() and _restart()
