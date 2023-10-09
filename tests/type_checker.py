# -*- encoding: utf-8 -*-
"""
USAGE:
    check_type(....)
DESC:
    runtime type checker for json data (structures, types, and values).
"""


__all__ = [
    "Literal",
    "Optional",
    "Union",
    "List",
    "Tuple",
    "Mapping",
    "Object",
    "Missing",
    "Size",
    "Not",
    "Both",
    "NotNull",
    "Null",
    "Exists",
    "NotExists",
    "MissingOrNull",
    "MissingOrNotNull",
    "Empty",
    "NotEmpty",
    "Required",
    "Dynamic",
    "TypeCheckError",
    "strict",
    "check_type"
]

import re
import sys
import attrs
import typing
import dataclasses

from enum import EnumMeta
from functools import partial
from operator import attrgetter
from typing import final, get_args
from contextlib import contextmanager


_typing_literal_specialForm = type(typing.Literal)
_typing_literal_genericAlias = type(typing.Literal[True])
_json_python_types = (str, int, float, bool, list, dict)
_json_python_literal_types = (type(None), str, int, float, bool)


@attrs.define(kw_only=True)
class _TipItem(object):
    path: str
    expect: typing.Optional[type]
    actual: typing.Optional[type]
    hint: typing.Optional[str]
    instance: typing.Any
    level: int          # for message indent
    context: bool       # trivial, possibly for debug


def _normalize_path(paths: typing.List[str]) -> str:
    return "".join(paths)


def _format_message(path: str, infos: typing.List[_TipItem]) -> str:
    def _format_info(_min_level, info: _TipItem):
        path_indent = "\t" * (info.level - _min_level)
        details_indent = path_indent + "\t"
        msg = f"{path_indent}-> {info.path}"
        sep_prefix = chr(10) + details_indent
        if info.expect:
            msg += f"{sep_prefix}expect type: `{info.expect!r}`"
        if info.actual:
            msg += f"{sep_prefix}got type:    `{info.actual!r}`"
            if isinstance(info.instance, (list, dict)):
                msg += f" (length={len(info.instance)})"
        if isinstance(info.instance, _json_python_literal_types):
            msg += f"{sep_prefix}got value:   {info.instance!r}"
        if info.hint:
            msg += f"{sep_prefix}hint:：      {info.hint}"
        return msg
    infos.reverse()
    min_level = min(infos, key=attrgetter("level")).level
    message = f"=> {path} <= " + chr(10)
    message += chr(10).join([m for m in map(
        partial(_format_info, min_level), infos)])
    return message


def _get_indicator(instance):
    if isinstance(instance, tuple):
        return instance
    frame = sys._getframe(2)
    indicator = frame.f_locals.get("indicator", None)
    if indicator is None:
        raise LookupError
    return indicator, instance
    # for i in range(1, 8):
    #     frame = getattr(sys, "_getframe")(i)
    #     if "indicator" in frame.f_locals:
    #         return frame.f_locals["indicator"], instance
    # raise LookupError


@final
class TypeCheckError(Exception):
    pass


class _Isolated(object):
    owner = None

    @classmethod
    def set_owner(cls, owner: '_CheckCaller') -> None:
        cls.owner = owner


class _IndicatorMeta(type):
    def __init__(cls, *args):
        super().__init__(*args)
        cls.path: typing.List[str] = ["$ROOT"]
        cls.info: typing.List[_TipItem] = []

        cls._union_context_depth: int = 0

    @property
    def in_union_context(cls) -> bool:
        return cls._union_context_depth > 0

    @contextmanager
    def enter_union_context(cls) -> None:
        try:
            cls._union_context_depth += 1
            yield
        finally:
            cls._union_context_depth -= 1

    def get_path(cls):
        return _normalize_path(cls.path)

    def push_path(cls, key, *, is_index=False) -> None:
        partial_path = f"[{key!s}]" if is_index else f".{key}"
        cls.path.append(partial_path)

    def pop_path(cls) -> None:
        cls.path.pop()

    def set_tips(cls, *, expect=None, actual=None,
                 hint=None, instance=None) -> None:
        cls.info.append(_TipItem(path=cls.get_path(),
                                 expect=expect,
                                 actual=actual,
                                 hint=hint,
                                 instance=instance,
                                 level=len(cls.path) - 1,
                                 context=cls.in_union_context))
        if cls.in_union_context:
            cls.pop_path()


class _GenericBase(object):
    def __init__(self):
        raise TypeError(f"<class '{self.__class__.__name__}'> can't be instantiated")

    def __init_subclass__(cls, **kwargs):
        if len(cls.__mro__) > 4:
            raise TypeError(f"<class '{cls.__module__}.{cls.__name__}'> can't be derived into subclass any more")


def _check_count(mcs, min_count, max_count, item: tuple, src) -> None:
    if 0 < min_count == max_count and len(item) != min_count:
        raise TypeError(f"type declaration error, should take exactly {min_count} item(s): {src!r}")
    if min_count > 0 and len(item) < min_count:
        raise TypeError(f"type declaration error, at least {min_count} item(s) is required: {src!r}")
    if 0 < max_count < len(item):
        raise TypeError(f"type declaration error, at most {max_count} item(s) is allowed: {src!r}")


def _check_itemtype(mcs, typ, item: tuple, src) -> None:
    if typ is object:
        for arg in item:
            if not isinstance(arg, _json_python_literal_types):
                if isinstance(mcs, _LiteralType):
                    """
                    Note: @tag: <enum.Enum> support
                        add support for <enum.Enum> for <Literal>: eg: Literal[ColorNamesEnum]
                    Motivation: the literal value itself can't directly be used for <enum.Enum>
                    instance check(`isinstance('a', (Enum, )) == False`). for this reason, 
                    when the <enum.Enum> present at the subscription expression, eg: Optional[Enum], 
                    this way the system will fails to check instance. to solve this, we use <Literal> 
                    to wrap the <enum.Enum>.
                    """
                    if isinstance(arg, EnumMeta):
                        if len(item) > 1 or len(arg) == 0:
                            raise TypeError("type declaration error: at present, <Literal> can "
                                            "only take exactly 1 <enum.Enum> type if provided, "
                                            "and this <enum.Enum> type should takes at least 1 "
                                            "enum element. eg: Literal[ColorNamesEnum]. "
                                            f"got {src!r}")
                        continue
                    """ 
                    Note: @tag: <typing.Literal> support
                      add support for <typing.Literal> for <Literal>: eg: Literal[typing.Literal['color', ...]]
                    Motivation: while use <Literal> standalone, the IDE's static type checker always 
                      introduces some type hint issues for this type, even thought each item is 
                      just normally literal value. however, this affect static type check only.
                      to solve this problem(reducing un-necessary type hints of static type checker 
                      of IDE), we use typing's original Literal type to wrap the literal value.
                    """
                    if isinstance(arg, (_typing_literal_specialForm, _typing_literal_genericAlias)):
                        if len(item) > 1 or len(get_args(arg)) == 0:
                            raise TypeError("type declaration error: at present, <Literal> can "
                                            "only take exactly 1 <typing.Literal> type if provided, "
                                            "and this <typing.Literal> type should takes at least 1 "
                                            "literal value. eg: Literal[typing.Literal['color']. "
                                            f"got: {src!r}")
                        return
                raise TypeError("type declaration error: each item should be a "
                                f"literal value. got {arg!r} within the expression {src!r}")
        return
    if typ is type:
        _typ = type(mcs)
        _ellipsis_pos = []
        for i, arg in enumerate(item):
            if not (isinstance(arg, (_GenericTypeMeta, ))
                    or arg in _json_python_types):
                if _typ is _LimitedListType and arg is Ellipsis:
                    _ellipsis_pos.append(i)
                    continue
                raise TypeError("type declaration error: each item should be a <_Generic> "
                                f"type. got {arg!r} within the expression {src!r}")
            global _no_sticky_type
            if _typ in _no_sticky_type and isinstance(arg, _typ):
                raise TypeError(f"type declaration error: sticky declaration for this type <{mcs.__name__}>, "
                                f"merge into one is required. within the expression {src!r}")
        if _typ is _LimitedListType and len(_ellipsis_pos) > 0:
            if len(_ellipsis_pos) > 1 or _ellipsis_pos[0] == 0:
                raise TypeError(f"type declaration error: type declaration error: if '...' "
                                f"flag is provided in Tuple[], then it should present at most "
                                f"once, as well as not as the first item. got {src!r}")
        return
    else:
        for arg in item:
            if not isinstance(arg, typ):
                raise TypeError(f"type declaration error: each item should be a {typ!r} "
                                f"type. got {arg!r} within the expression {src!r}")


def _make_dynamic_types(mcs, item):
    typ, typ_name = mcs.__class__, f"{mcs.__name__}"
    if not isinstance(item, tuple):
        item = (item, )
    dynamic_type = typ(typ_name, (_GenericBase, ), dict(__args__=item, getitem=False))
    _check_count(mcs, mcs.__mincount__, mcs.__maxcount__, item, str(dynamic_type))
    _check_itemtype(mcs, mcs.__itemtype__, item, str(dynamic_type))
    return dynamic_type


def _make_not_subscriptable(mcs, item):
    name = repr(mcs)
    raise TypeError(f"<type `{name}`> is not subscriptable. "
                    f"got expression( * computed * ): {name}[{item!s}]")


def _monotonic_call_exception(cur_indicator, name, msg_suffix):
    raise TypeError(f"<type `{name}`> can't be "
                    f"used monotonically, {msg_suffix}. "
                    f"checking at => {cur_indicator.get_path()} <=")


def _get_type_hints(obj) -> typing.Tuple[typing.Union[dataclasses.Field, attrs.Attribute], ...]:
    if dataclasses.is_dataclass(obj):
        return dataclasses.fields(obj)
    if getattr(obj, "__attrs_attrs__", None) is not None:
        return attrs.fields(obj)
    return attrs.fields(attrs.define(obj))


class _GenericTypeMeta(type):
    def __new__(mcs, name, bases, namespace: dict):
        if namespace.get("__class_getitem__", None) is None:
            getitem_handler = _make_dynamic_types \
                if namespace.pop("getitem", False) is True \
                else _make_not_subscriptable
            namespace.update(__class_getitem__=getitem_handler)
        if namespace.get("__args__", None) is None:
            mincount = namespace.pop("mincount", None)
            maxcount = namespace.pop("maxcount", None)
            itemtype = namespace.pop("itemtype", None)
            namespace.update(__mincount__=classmethod(property(fget=lambda cls: mincount)),
                             __maxcount__=classmethod(property(fget=lambda cls: maxcount)),
                             __itemtype__=classmethod(property(fget=lambda cls: itemtype)))
        return type.__new__(mcs, name, bases, namespace)

    @property
    def __args__(cls):
        return cls.__dict__.get("__args__", None)

    @property
    def __instance__(cls):
        return cls.__dict__.get("__instance__", None)

    def __repr__(cls):
        if cls.__args__ is None:
            return cls.__name__
        __args__ = cls.__args__
        if cls.__name__ == "Literal":
            arg_names = map(
                lambda literal: f"'{literal}'"
                if isinstance(literal, str)
                else str(literal)
                    .removeprefix("<enum '")
                    .removesuffix("'>"),   # Note: @tag: <enum.Enum> support
                __args__)
        else:
            arg_names = map(lambda typ: "..." if typ is Ellipsis else str(typ)
                            .removeprefix("<class '")
                            .removesuffix("'>"), __args__)
        return f"{cls.__name__}[{','.join(arg_names)}]"


class _UnionType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if self.__args__ is None:
            _monotonic_call_exception(indicator, 'Union', 'it should takes at least 2 items')
        with indicator.enter_union_context():
            return isinstance(instance, self.__args__)


class _OptionalType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if self.__args__ is None:
            _monotonic_call_exception(indicator, 'Optional', 'it should takes exactly 1 item')
        if instance in (None, Ellipsis):
            return True
        return isinstance(instance, self.__args__)


class _ListType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if not isinstance(instance, list):
            return False
        if self.__args__ is None:
            return True
        __args__ = self.__args__[0]
        for index, element in enumerate(instance):
            indicator.push_path(index, is_index=True)
            if not isinstance(element, __args__):
                indicator.set_tips(expect=__args__,
                                   actual=type(element),
                                   instance=element)
                return False
            indicator.pop_path()
        return True


class _LimitedListType(_GenericTypeMeta):
    """
    supports:
        Tuple[typ, typ]
        Tuple[typ, typ, ...]
        Tuple[typ, ..., typ]
    incorrect:
        Tuple[..., typ]
    """
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if self.__args__ is None:
            _monotonic_call_exception(indicator, 'Tuple', 'it should takes at least 1 item')
        if not isinstance(instance, list):
            return False
        __args__ = self.__args__
        arg_len, inst_len = len(self.__args__), len(instance)
        ellipsis_idx, ellipsis_cutoff_suffix_len = -1, -1
        pre_iter_len = inst_len
        if Ellipsis in __args__:
            if inst_len < (arg_len - 1):
                return False
            ellipsis_idx = __args__.index(Ellipsis)
            ellipsis_cutoff_suffix_len = arg_len - (ellipsis_idx + 1)
            pre_iter_len = inst_len - ellipsis_cutoff_suffix_len
        elif inst_len != arg_len:
            return False
        for i in range(pre_iter_len):
            indicator.push_path(i, is_index=True)
            if ellipsis_idx == -1 or i < ellipsis_idx:
                typ = __args__[i]
            else:
                typ = __args__[i - 1]
            if not isinstance(instance[i], typ):
                indicator.set_tips(expect=typ,
                                   actual=type(instance[i]),
                                   instance=instance[i])
                return False
            indicator.pop_path()
        for i in range(-ellipsis_cutoff_suffix_len, 0):
            indicator.push_path(i, is_index=True)
            if not isinstance(instance[i], __args__[i]):
                indicator.set_tips(expect=__args__[i],
                                   actual=type(instance[i]),
                                   instance=instance[i])
                return False
            indicator.pop_path()
        return True


class _MappingType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if not isinstance(instance, dict):
            return False
        if self.__args__ is None:
            return True
        k_type, v_type = self.__args__
        for k in instance:
            indicator.push_path(k)
            if not isinstance(k, k_type):
                indicator.set_tips(expect=k_type,
                                   actual=type(k),
                                   hint=f"mapping's key type error",
                                   instance=k)
                return False
            if not isinstance(instance[k], v_type):
                indicator.set_tips(expect=v_type,
                                   actual=type(instance[k]),
                                   hint=f"mapping's value type error",
                                   instance=instance[k])
                return False
            indicator.pop_path()
        return True


class _LiteralType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if self.__args__ is None:
            if not isinstance(instance, _json_python_literal_types):
                return False
        __args__ = self.__args__
        if len(__args__) == 1:
            # Note: @tag: < enum.Enum > support
            if isinstance(__args__[0], EnumMeta):
                return indicator.owner._for_enums_type(instance, __args__[0])
            # Note: @tag: <typing.Literal> support
            if isinstance(__args__[0], _typing_literal_genericAlias):
                return instance in get_args(__args__[0])
        return instance in __args__


class _ObjectType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if self.__args__ is None:
            if self.__mro__[0] is Object:
                _monotonic_call_exception(indicator, 'Object', 'and it is not subscriptable')
        if not isinstance(instance, dict):
            return False
        """ 
        Important: for attrs.define() decorated class or non-decorated class,
        those fields without a type annotation are not be handled at all, and no errors
        or warnings will be reported(instead, dataclass() decorated class will report 
        an error). this is due to the system mechanism of attrs.
        """
        attributes = _get_type_hints(self)
        for field in attributes:
            cur_object = instance.get(field.name, Ellipsis)
            _is_dynamic_type = isinstance(field.type, _AliasType) \
                and field.type.__name__ == "Dynamic"
            if not _is_dynamic_type:
                indicator.push_path(field.name)
                result = indicator.owner.walks_check(cur_object, field.type)
                if result is False:
                    indicator.set_tips(expect=field.type,
                                       actual=type(cur_object),
                                       instance=cur_object)
                    return False
                indicator.pop_path()
                continue

            _is_alias_instance = field.type is not Dynamic
            _is_cls_decorated = not isinstance(field.default, (attrs.Attribute, dataclasses.Field))
            metadata = field.metadata if _is_cls_decorated else field.default.metadata
            if _is_alias_instance:
                args = field.type.__args__
                if len(args) not in (3, 4):
                    raise TypeError
                true_type, false_type = (args[-1], Missing) \
                    if len(args) == 3 else args[-2:]
                metadata = metadata.copy()
                metadata.update(true=true_type, false=false_type, test=args[:2])
            indicator.push_path(field.name)
            result, using, flag = indicator.owner.context_check(
                self, field.type, field.name, metadata, cur_object, instance)
            if result is False:
                flag = "'specified'" if flag is None else bool(flag)
                expect, hint = using, f"dynamic computed: {flag!s}"
                indicator.set_tips(expect=expect,
                                   actual=type(cur_object),
                                   instance=cur_object,
                                   hint=hint)
                return False
            indicator.pop_path()

        cls_strict = getattr(self, "__strict_class__", None)
        using_strict = cls_strict if cls_strict is not None \
            else indicator.owner.is_strict
        if using_strict:
            fields_keys = {field.name for field in attributes}
            instance_keys = set(instance.keys())
            diff_keys = instance_keys.difference(fields_keys)
            if len(diff_keys) > 0:
                indicator.set_tips(expect=self,
                                   actual=type(instance),
                                   instance=instance,
                                   hint=f"got redundant keys: {list(diff_keys)!s}")
                return False
        return True


class _MissingType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        return instance is Ellipsis


class _SizeType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if self.__args__ is None:
            _monotonic_call_exception(indicator, 'Size', 'it should takes exactly 1 item')
        if not isinstance(instance, (list, dict)):
            return False
        return len(instance) == self.__args__[0]


class _NotType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if self.__args__ is None:
            _monotonic_call_exception(indicator, 'Not', 'it should takes exactly 1 item')
        return instance is not Ellipsis and not isinstance(instance, self.__args__)


class _BothType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if self.__args__ is None:
            _monotonic_call_exception(indicator, 'Both', 'it should takes exactly 2 items')
        typ1, typ2 = self.__args__
        for typ in typ1, typ2:
            # note: no push_path() and pop_path() here
            if not isinstance(instance, typ):
                indicator.set_tips(expect=typ,
                                   actual=type(instance),
                                   instance=instance)
                return False
        return True


class _AliasType(_GenericTypeMeta):
    def __instancecheck__(self, instance):
        indicator, instance = _get_indicator(instance)
        if self.__instance__ is None:
            _monotonic_call_exception(indicator, 'Required', 'it should takes exactly 1 item')
        return isinstance(instance, self.__instance__)


_no_sticky_type = (_OptionalType, _NotType)


def _make(name, mcs, subscriptable,
          mincount, maxcount, itemtype, _instance=None):
    namespace = dict(getitem=subscriptable,
                     mincount=mincount,
                     maxcount=maxcount,
                     itemtype=itemtype)
    if _instance is not None:
        namespace.update(__instance__=_instance)
    return mcs(name, (_GenericBase, ), namespace)


def _alias(name, cls):
    return _make(name, _AliasType, False, -1, -1, None, cls)


Union = _make('Union', _UnionType, True, 2, -1, type)
Optional = _make('Optional', _OptionalType, True, 1, 1, type)
List = _make('List', _ListType, True, 1, 1, type)
Tuple = _make('Tuple', _LimitedListType, True, 1, -1, type)
Literal = _make('Literal', _LiteralType, True, 1, -1, object)
Mapping = _make('Mapping', _MappingType, True, 2, 2, type)
Object = _make('Object', _ObjectType, False, -1, -1, None)
Missing = _make('Missing', _MissingType, False, -1, -1, None)
Size = _make('Size', _SizeType, True, 1, 1, int)
Not = _make('Not', _NotType, True, 1, 1, type)
Both = _make('Both', _BothType, True, 2, 2, (_SizeType, _MappingType, _ListType, _LimitedListType))

Null = _alias('Null', Literal[None])
NotNull = _alias('NotNull', Not[Null])
Exists = _alias('Exists', Not[Missing])
NotExists = _alias('NotExists', Missing)
MissingOrNull = _alias('MissingOrNull', Union[Missing, Null])
MissingOrNotNull = _alias('MissingOrNotNull', Union[Missing, NotNull])
Empty = _alias('Empty', Union[Literal[None, 0, False, ''], Size[0]])
NotEmpty = _alias('NotEmpty', Not[Empty])


class Required(metaclass=_AliasType):
    """ Syntax: Required[<support_type>]
      examples:
        class TestType(Object):
            test_field: Required[str]
            some_field: Optional[....]

                # is equivalent to:

            test_field: str
            some_field: Optional[....]
    """
    def __class_getitem__(cls, item):
        return item


class Dynamic(metaclass=_AliasType):
    """ Syntax1: Dynamic[cx_key, cx_value, true_type[, false_type]]
      examples:
        class TestType(Object):
            # 3-elements
            test_field: Dynamic["another_key", "value", str]

            # 4-elements
            test_field: Dynamic["another_key", range(10), str, Missing]
      Note: this syntax is internally converted to Syntax2.
    ------------------------------------------------------
    Syntax2: Dynamic = field(metadata=dict(
        true=<support_type>,                # optional, if omitted, the `@test` param must
                                            be a callable that returns a <support_type>
        false=<support_type>,               # optional, default is <Missing>
        test=<callable>|<2-tuple_or_list>   # required, if is a tuple_or_list, it's internally
                                            converted to callable if possible. as a callable,
                                            it must returns a boolean value or <support_type>
                                            according to the existence of `@true` param.
    ))
      examples:
        class TestType(Object):
            # `@false` param omitted, and `@test` is a tuple_or_list
            test_field: Dynamic = field(metadata=dict(
                true=str,
                test=("another_key", "value")
            ))

            # `@false` param explicitly provided
            test_filed: Dynamic = field(metadata=dict(
                true=str,
                false=Missing,
                test=["another_key", re.compile("pattern")]
            ))

            # `@false` param is omitted, and `@test` is a callable which returns a boolean value
            test_field: Dynamic = field(metaclass=dict(
                true=str,
                test=lambda current_scope, current_key, current_value:
                    current_scope.get("another_key", None) == current_key
            ))

            # `@true` param is omitted, and `@test` is a callable which returns a <support_type> value
            test_field: Dynamic = field(metadata=dict(
                test=lambda current_scope, current_key, current_value:
                    str if current_value == "something" else Missing
            ))
    """
    def __class_getitem__(cls, item):
        if not isinstance(item, tuple):
            item = (item, )
        return _AliasType('Dynamic', (_GenericBase, ),
                          dict(__instance__=None, __args__=item))


class _CheckCaller(object):
    def __init__(self, *, strict_keys=True, raise_for_failed=True, **kwargs):
        if not isinstance(strict_keys, bool):
            raise TypeError("param error: @strict_key requires a bool value")
        if not isinstance(raise_for_failed, bool):
            raise TypeError("param error: @raise_for_failed requires a bool value")
        self._strict_mode = strict_keys
        self._raise_for_failed = raise_for_failed
        self.indicator = self._make_indicator()
        self.indicator.set_owner(self)

    def __call__(self, obj, typ, *, tag="", **kwargs) -> bool:
        if not isinstance(obj, (list, dict)):
            raise TypeError("param error: @obj: "
                            "the instance value to be checked must be a list or dict")
        if not isinstance(typ, (_ObjectType, _ListType, _LimitedListType)):
            raise TypeError("param error: @typ: "
                            "the type to be checked must be one of the follows: "
                            "<type 'Object'>、<type 'List'>、<type 'Tuple'>")
        if not isinstance(tag, str):
            raise TypeError("param error: @tag requires a str value")
        if not self.walks_check(obj, typ):
            path, infos = self.indicator.path, self.indicator.info
            path = _normalize_path(path)
            message = _format_message(path, infos)
            if tag and not tag.endswith(" "):
                tag = f"{tag} "
            if self._raise_for_failed:
                raise TypeCheckError(f'{tag}JSON validate failed：{message}')
            return False
        return True

    @property
    def is_strict(self):
        return self._strict_mode

    def _for_basic_type(self, obj, typ) -> bool:
        return isinstance(obj, typ)

    def _for_generic_type(self, obj, typ) -> bool:
        return isinstance((self.indicator, obj), typ)

    def _for_literals_type(self, obj, typ: Literal) -> bool:
        literals = typ.__args__
        return obj in literals

    def _for_enums_type(self, obj, typ: EnumMeta) -> bool:
        for enum_value in typ.__members__.values():
            if obj == enum_value.value:
                return True
        return False

    def _make_indicator(self):
        indicator = _IndicatorMeta("Indicator", (_Isolated, ), dict())
        return indicator

    def walks_check(self, obj, typ) -> bool:
        if isinstance(typ, _GenericTypeMeta):
            return self._for_generic_type(obj, typ)
        if typ in _json_python_types:
            return self._for_basic_type(obj, typ)
        raise TypeError(f"check_type(): not supported for the type {typ!r}")

    @staticmethod
    def _builtin_test_on_basic(cx_key, cx_value, scope, *args):
        return scope.get(cx_key, None) == cx_value

    @staticmethod
    def _builtin_test_on_nonetype(cx_key, cx_value, scope, *args):
        return scope.get(cx_key, ...) is None

    @staticmethod
    def _builtin_test_on_range(cx_key, cx_value, scope, *args):
        return scope.get(cx_key, None) in cx_value

    @staticmethod
    def _builtin_test_on_pattern(cx_key, cx_value, scope, *args):
        cx_obj = scope.get(cx_key, None)
        return isinstance(cx_obj, str) and bool(re.search(cx_value, cx_obj))

    def context_check(self, cls, typ, name, metadata, obj, scope) \
            -> typing.Tuple[bool, type, typing.Literal[0, 1, None]]:
        true_type = metadata.get("true", None)
        false_type = metadata.get("false", Missing)
        test = metadata.get("test", None)
        if isinstance(test, (tuple, list)):
            if len(test) != 2:
                raise TypeError
            cx_key, cx_value = test
            if not isinstance(cx_key, str):
                raise TypeError
            cx_value_typ_name = type(cx_value).__name__.lower()
            if isinstance(cx_value, (str, int, float, bool)):
                test = partial(self._builtin_test_on_basic, cx_key, cx_value)
            builtin_fn = getattr(self, f"_builtin_test_on_{cx_value_typ_name}", None)
            if builtin_fn is not None:
                test = partial(builtin_fn, cx_key, cx_value)
        if not callable(test):
            raise TypeError("dynamic type declaration error: @test must be a callable function. "
                            f"got type {type(test)!r}. checking at: {cls!s}.{name}")
        test_result = test(scope, name, obj)
        if isinstance(test_result, _GenericTypeMeta) \
                or test_result in _json_python_types:
            return self.walks_check(obj, test_result), test_result, None
        if not isinstance(test_result, bool):
            raise TypeError("context declaration error: @test() must return a boolean value. "
                            f"got type {type(test_result)!r}. checking at: {cls!s}.{name}")
        if true_type is not None:
            if test_result is True:
                return self.walks_check(obj, true_type), true_type, 1
            return self.walks_check(obj, false_type), false_type, 0
        flag = typing.cast(typing.Literal[0, 1], int(test_result))
        return test_result, typ, flag


def strict(key=None):
    def wrapper(cls):
        if not isinstance(cls, _ObjectType):
            raise TypeError("@strict(): the strict() decorator is designed for "
                            f"decorating <type 'Object'>'s subclass only. at {cls!s}")
        if key is not None and not isinstance(key, bool):
            raise TypeError(f"@strict(): param error. at {cls!s}")
        setattr(cls, "__strict_class__", key)
        return cls
    return wrapper


def check_type(obj, typ, **kwargs):
    return _CheckCaller(**kwargs)(obj, typ, **kwargs)
