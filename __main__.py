# -*- encoding: utf-8 -*-

"""
AUTHOR:
DATE: 2021~

DESCRIPTION:

"""

from pathlib import Path
from argparse import ArgumentParser
from aiohttp import web, log
from .controller import CommonController, EmptyController


parser = ArgumentParser(description="an aiohttp helper server for postman-enhance-scripts project")
parser.add_argument("--path")
parser.add_argument("--port", default=10999)


if __name__ == "__main__":
    args = parser.parse_args()
    log.logging.basicConfig(level=log.logging.DEBUG)
    app = web.Application(middlewares=[CommonController])
    app["static_directory"] = Path(__file__).parent.joinpath("static")
    app.router.add_routes([
        web.static("/static", app["static_directory"]),
        web.get("/favicon.ico", EmptyController),
        web.view("/ping", EmptyController),
        web.view("/echo", EmptyController),
        web.view("/{path:.*}", EmptyController)])
    web.run_app(app, host="127.0.0.1", path=args.path, port=args.port)
