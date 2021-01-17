# -*- encoding: utf-8 -*-

"""
AUTHOR:
DATE: 2020-12-13

DESCRIPTION:

"""


__all__ = [
    "CommonController"
]


from aiohttp import web, MultipartReader


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
        resp = await handler(request)
        return resp
