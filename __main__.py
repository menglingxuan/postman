# -*- encoding: utf-8 -*-

"""
AUTHOR:
DATE: 2020-12-13

DESCRIPTION:

"""

from argparse import ArgumentParser
from aiohttp import web
from .midllewares import CommonController
from .handlers import ViewController


parser = ArgumentParser(description="a aiohttp helper server for postman-enhance-scripts project")
parser.add_argument("--path")
parser.add_argument("--port", default=10999)


if __name__ == "__main__":

    args = parser.parse_args()
    app = web.Application(middlewares=[CommonController])
    app.router.add_routes([web.view("/{path:.*}", ViewController)])
    web.run_app(app, host="127.0.0.1", path=args.path, port=args.port)
