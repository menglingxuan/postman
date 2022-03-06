# -*- encoding: utf-8 -*-


__all__ = [
    "FeatureResult",
    "FeatureCfg",
    "Cfg",
    "Feature",
    "feature_it",
    "ModelCfgType",
    "CfgSectionType",
    "make_lazy_type"
]


from collections import UserDict
from abc import abstractmethod, ABC
from aiohttp.web import Response, json_response
from . import (t, e, re, sys, log, json, dataclass,
               dataclasses, Any, Union, AESDecrypter)


@dataclass()
class FeatureResult(object):
    data: Any
    errno: int = 0
    msg: str = "ok"
    desc: str = ""
    warnings: Union[list, tuple] = ()

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
            raise e.SystemError

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
            warnings=self.warnings
        ), **params)


# as decorator
class FeatureCfg(UserDict):
    # __parent_path__ = "config.remote.middlewares"
    __parent_path__ = ""

    def __call__(self, cls: 'Feature'):
        self.__annotations__ = self.data
        self.__belong_to = cls.__name__
        self.data = dict.fromkeys(self.__annotations__.keys())
        cls.init_cfg_meta(self)
        return cls

    def update_cfg(self, user_cfg: dict):
        annotations = self.__annotations__.copy()
        for key, value in user_cfg.items():
            ano = annotations.pop(key, None)
            if ano is None:
                raise e.FeatureError(f"未定义的配置参数: {key}。支持的配置参数: {annotations.keys()!s}")
            if not isinstance(ano, type):
                raise e.SystemError
            # if isinstance(ano, ModelCfgType) and ano in annotations.values():
            #     # 每一个 <ModelCfgType> 实例只能定义一次
            #     raise e.SystemError
            if not isinstance(value, ano):
                t.chain_reason(key, value, ano)
                raise e.FeatureError(f"配置参数值错误或类型错误: {t.reason(chain_info=True)}")
            self.data[key] = value


""" alias"""
Cfg = FeatureCfg


_resultCls_fields = tuple([field.name for field in dataclasses.fields(FeatureResult)])


class Feature(ABC):
    # cookie_prefix = "X-POSTMAN-DATA-"

    def __init__(self, name, data: str, cfg: dict):
        self.name = name
        self.data = data
        self.cfg = self._init_cfg(cfg)

    def __init_subclass__(cls, **kwargs):
        if not re.match(r"^Feature[A-Z][A-Z_a-z]+$", cls.__name__):
            raise e.SystemError

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

    """ /converter：去重首尾空格"""
    @property
    def pure_data(self):
        return self.data.strip()

    @abstractmethod
    async def feature_it(self) -> FeatureResult:
        raise NotImplementedError(f"此功能未实现: \"/{self.name}\"")


def add_response_header(resp: Response, feature):
    resp.headers.setdefault("Postman-Feature-Name", feature)


async def feature_it(request) -> Response:
    if request.headers.getone("Postman-Feature-Name", None) is None:
        raise Exception("未授权的请求，请勿直接请求")

    encrypted = await request.text()
    project_settings = request.app["settings"]["project"]
    trans_token = project_settings.get("token", "xxx")
    text = AESDecrypter.decrypt(trans_token, encrypted)
    name, cfg, data = text.split("|", 2)
    try:
        module = __import__(f"features.{name}", globals=globals(), fromlist=["FeatureCls"], level=2)
    except ImportError:
        raise NotImplementedError(f"此功能未实现：‘/{name}’")
    else:
        if not hasattr(module, "FeatureCls"):
            raise e.SystemError
        feature_cls = module.FeatureCls
        try:
            cfg = json.loads(AESDecrypter.decrypt(trans_token, cfg))
        except json.JSONDecodeError:
            raise e.SystemError
        log.info("接收到的配置参数：%s", json.dumps(cfg, indent=2))
        result = await feature_cls(name, data, cfg).feature_it()
        if not isinstance(result, FeatureResult):
            raise e.SystemError
        response = result.as_response()
        add_response_header(response, name)
        return response


class ModelCfgType(t._S):
    @classmethod
    def __prepare__(metacls, name, bases, **kwargs):
        return dict(__getitem__=metacls.__cls_getitem__,
                    __post_init__=metacls.__cls_post_init__,
                    keys=metacls.__cls_keys__,
                    get=metacls.__cls_get__,
                    getmany=metacls.__cls_getmany__,
                    update=metacls.__cls_update__)

    def __repr__(self):
        if hasattr(self, "_is_lazy"):
            return f"ModelCfgType::<{self.__name__}[\"{getattr(self, '_lazy_module_attr')}\"]>"
        return f"ModelCfgType::<{self.__module__}.{self.__name__}>"

    def __cls_getitem__(self, item):
        return dict.__getitem__(self.__dict__, item)

    def __cls_keys__(self, all=False):
        for k in self.__dict__.keys():
            if k == "__parent_path__":
                continue
            if all:
                yield k
            if self.__dict__[k] is not None:
                yield k

    def __cls_get__(self, item, default=None):
        return dict.get(self.__dict__, item, default)

    def __cls_getmany__(self, items, defaults=None):
        if defaults is None:
            defaults = (None for x in items)
        return [self.get(item, default) for item, default in zip(items, defaults)]

    def __cls_update__(self, **kwargs):
        for key, value in kwargs.items():
            fld = self.__dataclass_fields__.get(key, None)
            if fld is None:
                raise e.SystemError
            if not isinstance(value, fld.type):
                raise e.SystemError
            setattr(self, key, value)

    def __cls_post_init__(self, config_parent_path):
        self.__parent_path__ = config_parent_path
        for attr, field in self.__dataclass_fields__.items():
            if len(field.metadata) > 0:
                this_path = self.__parent_path__ + "." + attr
                t.CommonChecker(self, attr, field, this_path)

    def __instancecheck__(self, instance):
        if not isinstance(instance, dict):
            return False
        if not dataclasses.is_dataclass(self):
            raise e.SystemError
        # for lazy type
        if hasattr(self, "_is_lazy"):
            return True

        model_cfg: dict = instance.copy()
        fields: tuple[dataclasses.Field] = dataclasses.fields(self)
        for field in fields:
            key, typ = field.name, field.type
            default_value = dataclasses.MISSING
            if field.default != dataclasses.MISSING:
                default_value = field.default
            elif field.default_factory != dataclasses.MISSING:
                default_value = field.default_factory()
            still_missing = default_value == dataclasses.MISSING
            value = model_cfg.pop(key, None if still_missing else default_value)
            if still_missing and value is None:
                t.chain_reason(key, value, typ)
                return False
            if not isinstance(value, typ):
                t.chain_reason(key, value, typ)
                return False
            # for lazy type: 变量 typ 是动态生成的独立实例类，不是模块共享的
            if hasattr(typ, "_is_lazy"):
                typ._lazy_key = key
        if len(model_cfg) > 0:
            non_support_fields = ",".join(model_cfg.keys())
            t.reason(f"不支持的配置参数。{self.__doc__}")
            t.chain_reason(f"<{non_support_fields}>", instance, self)
            return False
        return True

    def _recheck_lazy_type(cls, field, model_cfg, lazy_module_name, lazy_module_abspath):
        if not hasattr(field.type, "_is_lazy"):
            return
        lazy_attr_name = getattr(field.type, "_lazy_module_attr")
        real_module = sys.modules[lazy_module_abspath]
        real_type = getattr(real_module, lazy_attr_name, None)
        if real_type is None:
            raise e.SystemError
        if not isinstance(model_cfg.get(field.name, None), real_type):
            raise e.FeatureError(f"{lazy_module_name}.{field.name}.{t.reason(chain_info=True)}")
        cls.__annotations__[field.name] = real_type

    def get_model_cfg(cls, user_cfg: Union[FeatureCfg, 'ModelCfgType'], *,
                      lazy_module_name=None,
                      lazy_module_abspath=None):
        if not dataclasses.is_dataclass(cls):
            raise e.SystemError
        for key, typ in user_cfg.__annotations__.items():
            if key == "__parent_path__":
                continue
            if typ is cls:
                model_key = key
                break
        else:
            raise e.SystemError
        if isinstance(user_cfg, FeatureCfg):
            model_cfg: dict = user_cfg.pop(model_key)
        else:
            model_cfg: dict = getattr(user_cfg, model_key)
            delattr(user_cfg, model_key)
        args = []
        fields: tuple[dataclasses.Field] = dataclasses.fields(cls)
        for field in fields:
            cls._recheck_lazy_type(field, model_cfg, lazy_module_name, lazy_module_abspath)
            default_value = dataclasses.MISSING
            if field.default != dataclasses.MISSING:
                default_value = field.default
            elif field.default_factory != dataclasses.MISSING:
                default_value = field.default_factory()
            if default_value == dataclasses.MISSING:
                args.append(model_cfg.pop(field.name))
                continue
            model_cfg.setdefault(field.name, default_value)
        rest_kwargs = model_cfg
        config_parent_path = (user_cfg.__parent_path__ + "." + model_key).lstrip(".")
        if lazy_module_name is not None:
            config_parent_path += "." + lazy_module_name
        return cls(config_parent_path, *args, **rest_kwargs)


class CfgSectionType(ModelCfgType):
    pass


def make_lazy_type(keyname):
    _LAZY_UPDATE = ""
    return dataclass(type.__new__(
        ModelCfgType, "_DynamicLazyType", (object, ), dict(_is_lazy=True,
                                                           _lazy_key=_LAZY_UPDATE,
                                                           _lazy_module=_LAZY_UPDATE,
                                                           _lazy_module_attr=keyname)))
