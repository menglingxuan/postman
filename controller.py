# -*- encoding: utf-8 -*-

"""
AUTHOR:

DESCRIPTION:

"""


__all__ = [
    "CommonController",
    "EmptyController"
]

import json, logging, warnings

from operator import methodcaller
from pathlib import Path
from traceback import format_exc
from aiohttp import web, log, web_exceptions
from aiohttp.typedefs import MultiDict, MultiDictProxy

from .modules.base import feature_it, e


logging.captureWarnings(True)


@web.middleware
class CommonController(object):
    def __new__(cls, request: web.Request, handler):
        return cls.request_common(request, handler)

    @classmethod
    async def request_common(cls, request, handler):
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("default", UserWarning)
            _graceful_error = True
            try:
                resource = request.match_info.route.resource
                if isinstance(resource, web.StaticResource):
                    return await cls._static_handler(request, handler)
                if isinstance(resource, web.PlainResource):
                    match_info = request.match_info.get_info()
                    path = match_info.get("path", "")
                    if path == "/favicon.ico":
                        return await cls._favicon_handler(request, handler)
                    if path[1:] in ("ping", "echo", "mock"):
                        return await methodcaller(f"_{path[1:]}_handler", request, handler)(cls)

                _graceful_error = False
                response = await feature_it(request)
                if not isinstance(response, web.Response):
                    raise e.FeatureError("系统错误")
                return response
            except BaseException as err:
                warns = list(map(lambda y: str(y.message), filter(lambda x: issubclass(x.category, UserWarning), w)))
                exception = str(err)
                stack = format_exc()
                log.server_logger.error(stack)
                is_direct_mode = int(request.headers.getone("Postman-Feature-Direct", "0"))
                return web.json_response(status=500 if _graceful_error or is_direct_mode else 200, data=dict(
                    errno=2,
                    msg="error",
                    desc=exception,
                    data=None,
                    stack=stack,
                    warnings=warns
                ))

    @classmethod
    async def _static_handler(cls, request, handler):
        return await handler(request)

    @classmethod
    async def _favicon_handler(cls, request, handler):
        static_directory = request.app.get("static_directory", "")
        favicon_ico = Path(static_directory).joinpath("favicon.ico")
        if not favicon_ico.exists():
            raise web_exceptions.HTTPNotFound
        if not favicon_ico.is_file():
            raise web_exceptions.HTTPForbidden
        return web.FileResponse(favicon_ico)

    @classmethod
    async def _ping_handler(cls, request, handler):
        return web.Response(text="pong")

    @classmethod
    async def _echo_handler(cls, request, handler):
        ready_resp = await cls._get_request_info(request, cls._unpack_collection)
        query = ready_resp["query"]
        origin_mode = query.pop("origin_mode", "") or None
        outcome_target = query.pop("outcome_target", "") or None
        outcome_format = query.pop("outcome_format", "") or None
        outcome_print = query.pop("outcome_print", None)
        body_metakey = ready_resp["body"].pop("_metakey", None)
        if outcome_target in ["body", "params", "query"]:
            return cls._echo_partial_data(request, outcome_target,
                                          outcome_format, ready_resp, body_metakey)
        if outcome_print is not None:
            log.client_logger.info(json.dumps(ready_resp))
        return web.json_response(data=ready_resp)

    @classmethod
    def _echo_partial_data(cls, request, outcome_target,
                           outcome_format, ready_resp, body_metakey):
        if outcome_target == "body":
            body = ready_resp["body"]
            body_exists = body.get("body_exists")
            normal_body = body.get("normal_body")
            content_type = body.get("content_type", None)
            if not normal_body:
                raise e.FeatureError(f"outcome_target='{outcome_target}'：目标内容格式不匹配content_type：{content_type}")
            outcome = body[body_metakey]
            if isinstance(outcome, dict):
                return web.json_response(data=outcome)
            if isinstance(outcome, str):
                return web.Response(text=outcome, content_type=outcome_format or content_type)
            if isinstance(outcome, (bytes, bytearray)):
                return web.Response(text=outcome, content_type=outcome_format or content_type)
        if outcome_target == "params" or outcome_target == "query":
            return web.json_response(data=ready_resp["query"])

    @staticmethod
    async def _get_request_info(request, unpack):
        body = dict(postman_body_type=request.query.getone("origin_mode", "") or None,
                    body_exists=request.body_exists,
                    content_type=request.content_type,
                    normal_body=request.body_exists)

        def set_body_content(key, content_tuple, _is_normal=None):
            if not isinstance(content_tuple, tuple):
                content_tuple = (None, content_tuple)
            error_cls, content = content_tuple
            is_normal = _is_normal if _is_normal is not None else error_cls is None
            body["normal_body"] = is_normal
            if is_normal or _is_normal is not None:
                body["_metakey"] = key
                body[key] = content
            elif error_cls:
                body[key] = content
            return is_normal

        async def get_text():
            try:
                return None, await request.text()
            except Exception as e:
                return type(e), f"Text DecodeError: {e!s}"

        async def get_json():
            try:
                return None, await request.json()
            except Exception as e:
                return type(e), f"Json DecodeError: {e!s}"

        if request.content_length is None:
            body.pop("content_type")
        elif request.content_length == 0:
            body.pop("content_type")
        elif request.content_type == "text/plain":
            set_body_content("text", await get_text())
        elif request.content_type == "application/json":
            _temp = await get_json()
            if not isinstance(_temp[1], (dict, list)):
                is_normal = False
            else:
                is_normal = set_body_content("json", _temp)
            if not is_normal:
                set_body_content("raw", await get_text(), False)
        elif request.content_type == "application/x-www-form-urlencoded":
            post = unpack(await request.post())
            # 一些请求方法（如：GET、LINK等）下：
            #   urlencoded 的参数不能通过`await request.post()`方法获取到
            #   但可以使用`await request.text()`方法获取，内容格式为urlencoded的query string样式，例：a=b&c=%26
            if len(post) == 0:
                from urllib.parse import parse_qs
                regular_dict = parse_qs(await request.text())
                post = unpack(regular_dict)
            set_body_content("urlencoded", post)
        elif request.content_type == "multipart/form-data":
            form_data = MultiDict()
            reader = await request.multipart()
            async for part_reader in reader:
                if part_reader.filename is not None:
                    # data = await part_reader.read()
                    # total_bytes = len(data)
                    # data = None
                    form_data.add(part_reader.name, dict(
                        filename=part_reader.filename,
                        # filesize=f"{total_bytes} bytes",
                        headers=unpack(part_reader.headers)
                    ))
                    continue
                field_value = await part_reader.text()
                form_data.add(part_reader.name, field_value)
            set_body_content("formdata", unpack(MultiDictProxy(form_data)))
        else:
            is_file = postman_body_type = body["postman_body_type"] == "file"
            if is_file:
                # is_normal = set_body_content("content", await get_text())
                set_body_content("stream", f"(文件大小：{request.content.total_bytes} bytes)")
            else:
                set_body_content("raw", await get_text())

        return dict(
            scheme=request.scheme,
            method=request.method,
            query=unpack(request.query),
            body=body,
            headers=unpack(request.headers),
            # 兼容不标准的键值对
            cookies=unpack(request.cookies) if len(request.cookies) else request.headers.getall("Cookie", dict()),
            # auth="not support yet",
            # certificates="not support yet",
            match_info=request.match_info.get_info(),
            url=str(request.url))

    @staticmethod
    def _unpack_collection(collection):
        keys = collection.keys()
        pairs = []
        for key in keys:
            value = collection.getall(key) if hasattr(collection, "getall") else collection.get(key)
            pairs.append((key, value[0] if len(value) == 1 else value))
        return dict(pairs)


class EmptyController(web.View):
    pass
