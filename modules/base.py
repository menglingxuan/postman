# -*- encoding: utf-8 -*-


__all__ = [
    "FeatureResult",
    "FeatureCfg",
    "Feature",
    "feature_it",
    "ModelCfgType",
    "Cfg"
]


import re
import json
import dataclasses

from abc import abstractmethod, ABC
from typing import Any
from collections import UserDict
from aiohttp.web import Response, json_response

from . import t, e, AESDecrypter


@dataclasses.dataclass()
class FeatureResult(object):
    data: Any
    errno: int = 0
    msg: str = "ok"
    desc: str = ""
    as_raw: bool = False
    is_json: bool = False
    is_bytes: bool = False
    _ori_extra: dict = dataclasses.field(default_factory=dict)

    def as_response(self):
        data_type = type(self.data)
        if self.data is None or \
                "text" in self._ori_extra or \
                "body" in self._ori_extra or \
                (self.is_json and self.is_bytes) or \
                (self.is_bytes and data_type is not bytes) or \
                (not self.is_bytes and data_type is not str):
            # server_logger.warn(str(dict(
            #     is_json=self.is_json,
            #     is_bytes=self.is_bytes,
            #     as_raw=self.as_raw,
            #     data_type=data_type,
            #     ori_extra_keys=list(self._ori_extra.keys())
            # )))
            raise e.ParamError()

        if self.as_raw:
            params = dict(text=self.data, content_type="text/plain")
            if self.is_json:
                params = dict(text=self.data, content_type="application/json")
            elif self.is_bytes:
                params = dict(body=self.data, content_type="application/octet-stream")
            params |= self._ori_extra
            return Response(**params)

        params = dict(content_type="application/json") | self._ori_extra
        return json_response(dict(
            errno=self.errno,
            msg=self.msg,
            data=self.data,
            desc=self.desc,
            warn=[]
        ), **params)


class FeatureCfg(UserDict):
    """ make it as decorator """
    def __call__(self, cls: 'Feature'):
        self.__annotations = self.data
        self.__belong_to = cls.__name__
        self.data = dict.fromkeys(self.__annotations.keys())
        cls.init_cfg_meta(self)
        return cls

    @property
    def annotations(self):
        return self.__annotations

    def update_cfg(self, user_cfg: dict):
        annotations = self.__annotations.copy()
        for key, value in user_cfg.items():
            ano = annotations.pop(key, None)
            if ano is None:
                raise SystemError(f"未定义的特性参数: \"{key}\"。支持的特性参数: {annotations.keys()!s}")
            if not isinstance(ano, type):
                raise e.DefinitionError()
            if isinstance(ano, ModelCfgType) and ano in annotations.values():
                # 每一个 <ModelCfgType> 实例只能定义一次
                raise e.DefinitionError()
            if not isinstance(value, ano):
                t.chain_reason(key, value, ano)
                raise SystemError(f"特性参数值错误或类型错误: {t.reason(chain_info=True)}")
            self.data[key] = value
        return self


""" alias"""
Cfg = FeatureCfg


_trans_token = "thisIsToken"
_resultCls_fields = tuple([field.name for field in dataclasses.fields(FeatureResult)])


class Feature(ABC):
    cookie_prefix = "X-POSTMAN-DATA-"

    def __init__(self, name, data: str, cfg: dict):
        self.name = name
        self.data = data
        self.cfg = self._init_cfg(cfg)

    def __init_subclass__(cls, **kwargs):
        if not re.match(r"^Feature[A-Z][A-Z_a-z]+$", cls.__name__):
            raise e.DefinitionError()

    def _init_cfg(self, cfg: dict):
        user_cfg: Cfg = self.__class__.__cfg
        user_cfg.update_cfg(cfg)
        cfg = user_cfg
        return cfg

    @classmethod
    def init_cfg_meta(cls, cfg: Cfg):
        cls.__cfg = cfg

    def set_result(self, data, **kwargs) -> FeatureResult:
        _ori_extra = dict()
        for key in tuple(kwargs.keys()):
            if key not in _resultCls_fields:
                _ori_extra[key] = kwargs.pop(key)
        kwargs["_ori_extra"] = _ori_extra
        return FeatureResult(data, **kwargs)

    """ 去重首尾空格"""
    @property
    def pure_data(self):
        return self.data.strip()

    @abstractmethod
    async def feature_it(self) -> FeatureResult:
        raise NotImplementedError(f"此功能未实现: \"/{self.name}\"")


# Deprecated!!!
def _get_things_from_cookies(cookies):
    args = [None] * len(cookies)
    for i, key in enumerate(cookies.keys()):
        if not key.startswith(Feature.cookie_prefix):
            continue
        [_, index] = key.split(Feature.cookie_prefix)
        if re.search(r"^[0-9]+$", index) is None:
            continue
        args[int(index)] = cookies.get(key)
    args = list(filter(None, args))
    if not len(args):
        raise SystemError(f"请求未包含有效的cookie: \"{Feature.cookie_prefix}*\"")
    return "".join(args)


def add_response_header(resp: Response, feature):
    resp.headers.setdefault("Postman-Feature-Name", feature)


async def feature_it(request) -> Response:
    if request.headers.getone("Postman-Feature-Name", None) is not None:
        encrypted = await request.text()
    else:
        # encrypted = _get_things_from_cookies(request.cookies)
        raise Exception("未授权的请求，请勿直接请求")
    text = AESDecrypter.decrypt(_trans_token, encrypted)

    name, cfg, data = text.split("|", 2)
    try:
        module = __import__(f"features.{name}", globals=globals(), fromlist=["FeatureCls"], level=2)
    except ImportError:
        raise NotImplementedError(f"此功能未实现: \"/{name}\"")
    else:
        feature_cls = module.FeatureCls
        cfg = json.loads(AESDecrypter.decrypt(_trans_token, cfg))
        result = await feature_cls(name, data, cfg).feature_it()
        if not isinstance(result, FeatureResult):
            raise e.DefinitionError()
        response = result.as_response()
        add_response_header(response, name)
        return response


class ModelCfgType(type):
    def __instancecheck__(self, instance):
        if not isinstance(instance, dict):
            return False
        if not dataclasses.is_dataclass(self):
            raise e.DefinitionError()

        model_cfg: dict = instance.copy()
        fields: tuple[dataclasses.Field] = dataclasses.fields(self)
        for field in fields:
            key, typ = (field.name, field.type)
            is_missing = field.default == dataclasses.MISSING
            value = model_cfg.pop(key, None if is_missing else field.default)
            if is_missing and value is None:
                t.chain_reason(key, value, typ)
                return False
            if not isinstance(value, typ):
                t.chain_reason(key, value, typ)
                return False
        if len(model_cfg) > 0:
            non_supports = list(model_cfg.keys())
            t.reason(f"不支持的特性参数。支持的特性参数：{self.__doc__}")
            t.chain_reason(f"{non_supports!s}", instance, self)
            return False
        return True

    def get_model_cfg(cls, user_cfg: FeatureCfg):
        if not dataclasses.is_dataclass(cls):
            raise e.DefinitionError()

        annotations = user_cfg.annotations
        for key, typ in annotations.items():
            if typ is cls:
                model_key = key
                break
        else:
            raise e.DefinitionError()
        model_cfg: dict = user_cfg.pop(model_key)
        args = []
        fields: tuple[dataclasses.Field] = dataclasses.fields(cls)
        for field in fields:
            if field.default == dataclasses.MISSING:
                args.append(model_cfg.pop(field.name))
                continue
            model_cfg.setdefault(field.name, field.default)
        rest_kwargs = model_cfg
        return cls(*args, **rest_kwargs)
