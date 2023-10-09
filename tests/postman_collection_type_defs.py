# -*- encoding: utf-8 -*-


import typing

from type_checker import *
from attrs import field, define
from enum import Enum
from typing import final


@final
class RequestMethodEnum(Enum):
    METHOD_GET = "GET"
    METHOD_POST = "POST"
    METHOD_PUT = "PUT"
    METHOD_PATCH = "PATCH"
    METHOD_DELETE = "DELETE"
    METHOD_COPY = "COPY"
    METHOD_HEAD = "HEAD"
    METHOD_OPTIONS = "OPTIONS"
    METHOD_LINK = "LINK"
    METHOD_UNLINK = "UNLINK"
    METHOD_PURGE = "PURGE"
    METHOD_LOCK = "LOCK"
    METHOD_UNLOCK = "UNLOCK"
    METHOD_PROPFIND = "PROPFIND"
    METHOD_VIEW = "VIEW"


@final
class RequestBodyModeEnum(Enum):
    BODY_MODE_FORMDATA = "formdata"
    BODY_MODE_URLENCODED = "urlencoded"
    BODY_MODE_RAW = "raw"
    BODY_MODE_FILE = "file"
    BODY_MODE_BINARY = "binary"
    BODY_MODE_GRAPHQL = "graphql"


@final
class RequestRawBodyLangEnum(Enum):
    BODY_LANG_TEXT = "text"
    BODY_LANG_JAVASCRIPT = "javascript"
    BODY_LANG_JSON = "json"
    BODY_LANG_XML = "xml"
    BODY_LANG_HTML = "html"
    BODY_LANG_GRAPHQL = "graphql"


@final
class RequestAuthTypeEnum(Enum):
    AUTH_TYPE_NOAUTH = "noauth"
    AUTH_TYPE_APIKEY = "apikey"
    AUTH_TYPE_BEARER = "bearer"
    AUTH_TYPE_BASIC = "basic"
    AUTH_TYPE_DIGEST = "digest"
    AUTH_TYPE_OAUTH1 = "oauth1"
    AUTH_TYPE_OAUTH2 = "oauth2"
    AUTH_TYPE_HAWK = "hawk"
    AUTH_TYPE_AWS = "awsv4"
    AUTH_TYPE_NTLM = "ntlm"
    AUTH_TYPE_EDGEGRID = "edgegrid"


@define
class CollectionDescription(Object):
    content: Optional[str]
    type: Optional[Literal[typing.Literal["text/markdown", "text/html"]]]
    # version: Optional[int]      # 源文档未注明类型，此为猜测


@define
class CollectionVersion(Object):
    major: int
    minor: int
    patch: int
    identifier: Optional[str]
    # meta: Optional[Mapping]


@define
class CollectionInfo(Object):
    name: str
    schema: Literal[typing.Literal["https://schema.getpostman.com/json/collection/v2.1.0/collection.json"]]
    _postman_id: Optional[str]
    description: Optional[CollectionDescription]
    version: Optional[CollectionVersion]


@define
class CollectionRequestQueryParam(Object):
    key: Optional[str]
    value: Optional[str]
    disabled: Optional[bool]
    description: Optional[CollectionDescription]


@define
class CollectionRequestUrlEncodedParameter(Object):
    key: Optional[str]
    value: Optional[str]
    disabled: Optional[bool]
    description: Optional[CollectionDescription]


@define
class CollectionRequestFormParameter(Object):
    key: Optional[str]
    value: Optional[str]
    disabled: Optional[bool]
    type: Optional[str]
    contentType: Optional[str]
    description: Optional[CollectionDescription]


@define
class CollectionRequestFileParameter(Object):
    src: Optional[str]
    content: Optional[str]


@define
class CollectionVariable(Object):
    id: Optional[str]
    key: Optional[str]
    value: Optional[str]
    type: Optional[Literal[typing.Literal["string", "boolean", "any", "number"]]]
    name: Optional[str]
    description: Optional[CollectionDescription]
    system: Optional[bool]
    disabled: Optional[bool]


@define
class CollectionRequestUrl(Object):
    raw: Optional[str]
    protocol: Optional[str]
    host: Optional[Union[str, List[str]]]
    path: Optional[Union[str, List[str]]]
    port: Optional[str]
    query: Optional[CollectionRequestQueryParam]
    hash: Optional[str]
    variable: Optional[CollectionVariable]


@define
class CollectionRequestProxy(Object):
    match: Optional[str]
    host: Optional[str]
    port: Optional[int]
    tunnel: Optional[bool]
    disabled: Optional[bool]


@define
class CollectionRequestCertificate(Object):
    name: Optional[str]
    matches: Optional[List[str]]
    key: Optional[Mapping[str, str]]
    cert: Optional[Mapping[str, str]]
    passphrase: Optional[str]


@define
class CollectionRequestAuthParameter(Object):
    key: str
    value: Optional[str]
    type: Optional[str]


@define
class CollectionRequestAuth(Object):
    _depend_on_type = field(metadata=dict(
        true=CollectionRequestAuthParameter,
        test=lambda current_scope, current_field, current_value:
            current_scope.get("type", None) == current_field
    ))

    type: Required[Literal[RequestAuthTypeEnum]]
    noauth: Dynamic = _depend_on_type
    apikey: Dynamic = _depend_on_type
    awsv4: Dynamic = _depend_on_type
    basic: Dynamic = _depend_on_type
    bearer: Dynamic = _depend_on_type
    digest: Dynamic = _depend_on_type
    edgegrid: Dynamic = _depend_on_type
    hawk: Dynamic = _depend_on_type
    oauth1: Dynamic = _depend_on_type
    oauth2: Dynamic = _depend_on_type
    ntlm: Dynamic = _depend_on_type


@define
class CollectionRequestHeader(Object):
    key: str
    value: str
    disabled: Optional[bool]
    description: Optional[CollectionDescription]


@define
class CollectionRequestBodyGraphQL(Object):
    query: str
    variables: Optional[str]


@define
class CollectionRequestBody(Object):
    mode: Optional[Literal[RequestBodyModeEnum]]
    options: Optional[Mapping]
    disabled: Optional[bool]
    raw: Dynamic["mode", "raw", str]
    graphql: Dynamic["mode", "graphql", CollectionRequestBodyGraphQL]
    urlencoded: Dynamic["mode", "urlencoded", CollectionRequestUrlEncodedParameter]
    formdata: Dynamic["mode", "formdata", CollectionRequestFormParameter]
    file: Dynamic["mode", "file", CollectionRequestFileParameter]


@define
class CollectionRequest(Object):
    url: Optional[Union[str, CollectionRequestUrl]]
    auth: Optional[CollectionRequestAuth]
    proxy: Optional[CollectionRequestProxy]
    certificate: Optional[CollectionRequestCertificate]
    method: Optional[Literal[RequestMethodEnum]]
    description: Optional[CollectionDescription]
    header: Optional[List[CollectionRequestHeader]]
    body: Optional[CollectionRequestBody]


@define
class CollectionRequestCookie(Object):
    domain: str
    path: str
    expires: Optional[str]
    maxAge: Optional[str]
    hostOnly: Optional[bool]
    httpOnly: Optional[bool]
    name: Optional[str]
    secure: Optional[bool]
    session: Optional[bool]
    value: Optional[str]
    extensions: Optional[List[Mapping]]


@define
class CollectionRequestResponse(Object):
    id: Optional[str]
    originalRequest: Optional[CollectionRequest]
    responseTime: Optional[Union[str, int, float]]
    timings: Optional[Mapping]
    header: Optional[List[Mapping]]
    cookie: Optional[CollectionRequestCookie]
    body: Optional[str]
    status: Optional[str]
    code: Optional[int]


@define
class CollectionEventScript(Object):
    id: Optional[str]
    type: Optional[Literal[typing.Literal['text/javascript']]]
    exec: Optional[list]
    src: Optional[Union[str, CollectionRequestUrl]]
    name: Optional[str]


@define
class CollectionRequestEvent(Object):
    listen: Literal[typing.Literal["prerequest"]]
    id: Optional[str]
    script: Optional[CollectionEventScript]
    disabled: Optional[bool]


@define
class CollectionTestsEvent(Object):
    listen: Literal[typing.Literal['test']]
    id: Optional[str]
    script: Optional[CollectionEventScript]
    disabled: Optional[bool]


@define
class CollectionItemRequest(Object):
    request: CollectionRequest
    id: Optional[str]
    name: Optional[str]
    description: Optional[CollectionDescription]
    variable: Optional[List[CollectionVariable]]
    event: Optional[Tuple[CollectionRequestEvent, CollectionTestsEvent]]
    response: Optional[List[CollectionRequestResponse]]
    protocolProfileBehavior: Optional[Mapping]


@define
class CollectionItemFolder(Object):
    item: List[CollectionItemRequest]
    name: Optional[str]
    description: Optional[CollectionDescription]
    variables: Optional[CollectionVariable]
    event: Optional[Tuple[CollectionRequestEvent, CollectionTestsEvent]]
    auth: Optional[CollectionRequestAuth]
    protocolProfileBehavior: Optional[Mapping]


@define
class CollectionRoot(Object):
    info: CollectionInfo
    item: Union[List[CollectionItemRequest], List[CollectionItemFolder]]
    event: Optional[Tuple[CollectionRequestEvent, CollectionTestsEvent]]
    variable: Optional[List[CollectionVariable]]
    auth: Optional[CollectionRequestAuth]
    protocolProfileBehavior: Optional[Mapping]


if __name__ == "__main__":
    import json
    from pathlib import Path
    test_filename = "postman_collectionV2.1_exported.json"
    test_file = Path(__file__).parent / test_filename
    with open(test_file, mode="r") as file:
        content = json.load(file)
    check_type(content, CollectionRoot)
