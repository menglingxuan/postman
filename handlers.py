# -*- encoding: utf-8 -*-

"""
AUTHOR:
DATE: 2020-12-13

DESCRIPTION:

"""


__all__ = [
    "ViewController"
]


from aiohttp import web


class ViewController(web.View):
    async def get(self):
        return web.Response(text="pong")

    async def post(self):
        return web.Response(text="pong")
