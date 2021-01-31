# -*- encoding: utf-8 -*-

"""
AUTHOR:
DATE: 2020-12-13

DESCRIPTION:

"""


__all__ = [
    "CommonController"
]

import sys

from datetime import datetime
from traceback import format_exc
from aiohttp import web, MultipartReader
from .features import FeatureError, decrypt


@web.middleware
class CommonController(object):
    def __new__(cls, request: web.Request, handler):
        return cls.request_common(request, handler)

    @staticmethod
    async def request_common(request, handler):
        # if request.content_type == "multipart/form-data":
        #     reader = await request.multipart()
        #     async for part_reader in reader:
        #         if part_reader.name == "file":
        #             print(f"{part_reader.name}={part_reader.filename}")
        #             continue
        #         field_value = await part_reader.text()
        #         print(f"{part_reader.name}={field_value}")
        print(await request.post())
        print(request.headers)
        print(request.match_info)
        print(request.query)
        print()
        try:
            response = await decrypt(request.cookies)
            if not isinstance(response, web.Response):
                raise FeatureError("unexpected feature's output")
        except BaseException as error:
            timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S %Z").strip()
            return web.json_response(data=dict(
                msg="error",
                desc=str(error),
                timestamp=timestamp,
                stack=format_exc().split("\n")
            ))
        else:
            return response

        """ pong """
        # resp = await handler(request)
        # return resp
