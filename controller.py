# -*- encoding: utf-8 -*-

"""
AUTHOR:

DESCRIPTION:

"""


__all__ = [
    "CommonController",
    "EmptyController"
]

import logging
import warnings

from pathlib import Path
from traceback import format_exc
from aiohttp import web, log, web_exceptions
from aiohttp.typedefs import MultiDict, MultiDictProxy

from .modules.base import feature_it, e


logging.captureWarnings(True)


@web.middleware
class CommonController(object):
    def __new__(cls, request: web.Request, handler):
        resource = request.match_info.route.resource
        if isinstance(resource, web.StaticResource):
            return cls._static_handler(request, handler)
        if isinstance(resource, web.PlainResource):
            match_info = request.match_info.get_info()
            path = match_info.get("path", "")
            if path == "/favicon.ico":
                return cls._favicon_handler(request, handler)
            if path == "/ping":
                return cls._ping_handler(request, handler)
            if path == "/echo":
                return cls._echo_handler(request, handler)
        return cls.request_common(request, handler)

    @classmethod
    async def request_common(cls, request, handler):
        with warnings.catch_warnings(record=True) as w:
            warnings.simplefilter("default", UserWarning)
            try:
                response = await feature_it(request)
                if not isinstance(response, web.Response):
                    raise e.FeatureError("系统错误")
            except BaseException as err:
                warns = list(map(lambda y: str(y.message), filter(lambda x: issubclass(x.category, UserWarning), w)))
                exception = str(err)
                stack = format_exc()
                log.server_logger.error(stack)
                is_direct_mode = int(request.headers.getone("Postman-Feature-Direct", "0"))
                return web.json_response(status=500 if is_direct_mode else 200, data=dict(
                    errno=2,
                    msg="error",
                    desc=exception,
                    data=None,
                    stack=stack,
                    warnings=warns
                ))
            else:
                return response

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
        return web.json_response(await cls._get_request_info(request, cls._unpack_collection))

    @staticmethod
    async def _get_request_info(request, unpack):
        body = dict(body_exists=request.body_exists,
                    content_type=request.content_type)
        if request.content_length is None:
            body.pop("content_type")
        elif request.content_length == 0:
            body.pop("content_type")
        elif request.content_type == "text/plain":
            body["text"] = await request.text()
        elif request.content_type == "application/json":
            try:
                body["json"] = await request.json()
            except Exception as e:
                body["json"] = f"(DecodeError: {e!s})"
                body["raw"] = await request.text()
        elif request.content_type == "application/x-www-form-urlencoded":
            body["urlencoded"] = unpack(await request.post())
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
            body["formdata"] = unpack(MultiDictProxy(form_data))
        elif request.content_type == "application/octet-stream":
            body["steam"] = f"(Stream: {request.content.total_bytes} bytes)"
        else:
            try:
                body["raw"] = await request.text()
            except:
                body["raw"] = f"(DecodeError: is file???. {request.content.total_bytes} bytes)"
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
