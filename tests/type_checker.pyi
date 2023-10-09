#

__all__ = [
    "TypeCheckError",
    "Union",
    "Optional",
    "List",
    "Tuple",
    "Literal",
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
    "strict",
    "check_type"
]

import typing

from typing import Type, overload
from enum import EnumMeta
from types import NoneType

class TypeCheckError(Exception): ...

class _GenericTypeMeta(type):
    def __new__(mcs, name, bases, namespace) -> _GenericTypeMeta: ...

class _UnionType(_GenericTypeMeta): ...
class _OptionalType(_GenericTypeMeta): ...
class _ListType(_GenericTypeMeta): ...
class _LimitedListType(_GenericTypeMeta): ...
class _MappingType(_GenericTypeMeta): ...
class _LiteralType(_GenericTypeMeta): ...
class _ObjectType(_GenericTypeMeta): ...
class _MissingType(_GenericTypeMeta): ...
class _SizeType(_GenericTypeMeta): ...
class _NotType(_GenericTypeMeta): ...
class _BothType(_GenericTypeMeta): ...
class _AliasType(_GenericTypeMeta): ...


_JsonNotNullType = typing.Union[str, int, float, bool, list, dict]
_JsonAllType = typing.Optional[_JsonNotNullType]
_JsonLiteralType = typing.Optional[typing.Union[str, int, float, bool]]

_SupportTypeType = typing.Union[_GenericTypeMeta, EnumMeta, Type[_JsonNotNullType]]

_UnionItemsType = typing.Tuple[_SupportTypeType, ...]
class Union(metaclass=_UnionType):
    def __class_getitem__(cls, item: _UnionItemsType) -> _UnionType: ...

_OptionalItemType = _SupportTypeType
class Optional(metaclass=_OptionalType):
    def __class_getitem__(cls, item: _OptionalItemType) -> _OptionalType: ...

_WrappedLiteral = typing.Union[typing.Literal, _JsonLiteralType]
_LiteralItems = typing.Union[_WrappedLiteral, typing.Tuple[_WrappedLiteral, ...]]
class Literal(metaclass=_LiteralType):
    def __class_getitem__(cls, item: _LiteralItems) -> _LiteralType: ...

_ListItemsType = _SupportTypeType
class List(metaclass=_ListType):
    def __class_getitem__(cls, item: _ListItemsType) -> _ListType: ...

_TupleItemsType = typing.Union[_SupportTypeType, typing.Tuple[_SupportTypeType, ...]]
class Tuple(metaclass=_LimitedListType):
    def __class_getitem__(cls, item: _TupleItemsType) -> _LimitedListType: ...

_MappingKeyType = Type[str]
_MappingValueType = _SupportTypeType
_MappingPairsType = typing.Tuple[_MappingKeyType, _MappingValueType]
class Mapping(metaclass=_MappingType):
    def __class_getitem__(cls, item: _MappingPairsType) -> _MappingType: ...

class Object(metaclass=_ObjectType): ...
class Missing(metaclass=_MissingType): ...

class Size(metaclass=_SizeType):
    def __class_getitem__(cls, item: int) -> _SizeType: ...

_NotItemType = _SupportTypeType
class Not(metaclass=_NotType):
    def __class_getitem__(cls, item: _NotItemType) -> _NotType: ...

_SupportSizeType = typing.Union[_LimitedListType, _ListType, _MappingType]
_BothItemType1 = typing.Tuple[_SizeType, _SupportSizeType]
_BothItemType2 = typing.Tuple[_SupportSizeType, _SizeType]
class Both(metaclass=_BothType):
    @overload
    def __class_getitem__(cls, item: _BothItemType1) -> _BothType: ...
    @overload
    def __class_getitem__(cls, item: _BothItemType2) -> _BothType: ...

NotNull: _AliasType
Null: _AliasType
Exists: _AliasType
NotExists: _AliasType
MissingOrNull: _AliasType
MissingOrNotNull: _AliasType
Empty: _AliasType
NotEmpty: _AliasType

class Required(object):
    def __class_getitem__(cls, item: _SupportTypeType) -> object: ...

_DynamicItemType1 = typing.Tuple[str, object, _SupportTypeType]
_DynamicItemType2 = typing.Tuple[str, object, _SupportTypeType, _SupportTypeType]
class Dynamic(object):
    @overload
    def __class_getitem__(cls, item: _DynamicItemType1) -> object: ...
    @overload
    def __class_getitem__(cls, item: _DynamicItemType2) -> object: ...

def strict(key: bool = True, element: bool = True) -> _ObjectType: ...

def check_type(obj: typing.Any, typ: _GenericTypeMeta, tag: str = "", *,
               strict_keys: bool = True,
               raise_for_failed: bool = True) -> bool: ...
