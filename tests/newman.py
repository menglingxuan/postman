# -*- encoding: utf-8 -*-
"""
DESC:
    postman schema: <https://schema.postman.com/>
    postman collection v2.1 schema documentation: <https://schema.postman.com/collection/json/v2.1.0/draft-07/docs/index.html>
    postman collection v2.1 schema json: <https://schema.postman.com/collection/json/v2.1.0/draft-07/collection.json>
"""


__all__ = [
    "collection",
    "defaults",
    "methods",
    "modes",
    "langs"
]


import copy
import json
import operator
import subprocess

from hashlib import md5
from typing import final
from pathlib import Path
from attrs import define, field
from urllib3.util import parse_url, Url
from subprocess import CompletedProcess
from postman_collection_type_defs import *


@final
class MaterialDefaults(object):
    @property
    def url(self):
        return "http://127.0.0.1:10999/echo"

    @property
    def nobody(self):
        return []


@final
class DefaultsProxy(object):
    def __getattr__(self, item):
        return operator.attrgetter(item)


# @final
# @define(kw_only=True)
# class RequestMaterial(object):
#     def _to_url(self) -> dict:
#         url_info: Url = parse_url(self.url)
#         return dict(
#             raw=self.url,
#             protocol=url_info.scheme or "http",
#             host=url_info.host.split(".")[:],
#             port=str(url_info.port) or "",
#             path=url_info.path.split("/")[1:],
#         )
#
#     def _to_body(self):
#         pass
#
#     def _to_request(self) -> dict:
#         return dict(
#             method=self.method,
#             header=self.headers,
#             url=self._to_url(),
#             response=[]
#         )
#
#     def to_request(self) -> dict:
#         if self.default is True:
#             self.__dict__.update(
#                 name="New Request",
#                 method=RequestMethodEnum.METHOD_GET,
#                 url="http://127.0.0.1:10999/echo",
#                 query=[],
#                 auth=[],
#                 headers=[],
#                 cookies=[]
#             )
#         request = dict(
#             name=self.name,
#             request=self._to_request()
#         )
#         check_type(request, typ=CollectionItemRequest, strict=True)
#         return request


@final
class CollectionBuilder(object):
    _schema_json: dict = None
    _rootdir: Path = None
    _template: dict = None

    # @classmethod
    # def initial(cls, config: Config) -> None:
    #     cls._rootdir = config.rootpath
    #
    #     ready_collection_schema_file = config.getini("collection_schema_file")
    #     try:
    #         with open(cls._rootdir / ready_collection_schema_file, "r") as content:
    #             collection = json.load(content)
    #     except json.JSONDecodeError:
    #         raise ValueError("Postman Collection JSON 数据模板错误")
    #     else:
    #         check_type(collection, strict=True)
    #         cls._template = collection

    def __init__(self, **materials):
        self._materials = materials
        self._defaults = MaterialDefaults

    def __call__(self, test_function):
        setattr(test_function, "_pytest_scene", self)
        return test_function

    def __repr__(self):
        return f"<class 'CollectionBuilder' {self._require} requests>"

    def _build_events(self, mid_json) -> dict:
        return mid_json

    def _build_requests(self, mid_json) -> dict:
        requests = []
        for i in range(self._require):
            request_material = self._materials[i]
            request = request_material.to_request()
            requests.append(request)
        mid_json.update(item=requests)
        return mid_json

    def _to_full_json(self) -> dict:
        mid_json = copy.deepcopy(self._schema_json)
        mid_json = self._build_requests(mid_json)
        mid_json = self._build_events(mid_json)
        full_json = mid_json
        return full_json

    @staticmethod
    def _get_filename(content: str) -> str:
        m = md5()
        m.update(bytes(content))
        name = str(m.hexdigest())
        return name

    def to_file(self, directory: Path) -> Path:
        if not (directory.exists() and directory.is_dir()):
            raise ValueError(f"@directory: param error, dir '{directory!s}' not found")
        full_json = self._to_full_json()
        serialized = json.dumps(full_json, indent=2)
        filename = self._get_filename(serialized)
        filepath = directory / filename
        with open(filepath, mode="w") as fs:
            fs.write(serialized)
        return filepath

    @classmethod
    def add_request(cls, *, method, url, **kwargs):
        kwargs.update(method=method, url=url)
        return cls(**kwargs)

    def set_defaults(self, default_cls):
        self._defaults = default_cls


collection = CollectionBuilder
defaults = DefaultsProxy()
methods = RequestMethodEnum
modes = RequestMethodEnum
langs = RequestRawBodyLangEnum


@final
class NewmanOutput(object):
    def __init__(self, subprocess_output: CompletedProcess):
        self._result = subprocess_output

    def __getattr__(self, item):
        if not hasattr(self._result, item):
            raise AttributeError(f"no attribute named '{item}'")
        return getattr(self._result, item)

    def __repr__(self):
        return f"<class 'NewmanOutput' returned_code={self._result.returncode}"

    @classmethod
    def run(cls, collection: Path, **newman_options) -> 'NewmanOutput':
        if not (collection.exists() and collection.is_file()):
            raise ValueError(f"@collection: param error, file '{collection!s}' not found")
        _newman_options = []
        for key in newman_options:
            if not key.startswith("newman_"):
                raise TypeError(f"@newman_options: param error")
            opt_name = key.removeprefix("newman_")
            opt_val = newman_options[key]
            _newman_options.append(f"--{opt_name}")
            _newman_options.append(opt_val)
        newman_args = ["newman", "run", *_newman_options]
        output: CompletedProcess = subprocess.run(newman_args,
                                                  shell=False,
                                                  capture_output=True,
                                                  check=False)
        return cls(output)
