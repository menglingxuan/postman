# -*- encoding: utf-8 -*-

"""
AUTHOR:
DATE: 2021.05~2022

DESCRIPTION: the backend server for 'postman super utility' project POWERED BY the same author

"""

from pathlib import Path
from argparse import ArgumentParser
from configparser import ConfigParser
from aiohttp import web, log
from .controller import CommonController, EmptyController


parser = ArgumentParser(description="this is the backend server for 'postman super"
                                    " utility' project POWERED BY the same author")
parser.add_argument("--path")
parser.add_argument("--port", default=10999)
parser.add_argument("--host", default="127.0.0.1")


if __name__ == "__main__":
    args = parser.parse_args()
    log.logging.basicConfig(level=log.logging.DEBUG)
    app_config = ConfigParser()
    app_config.read(Path(__file__).parent / "settings.conf")
    app = web.Application(middlewares=[CommonController])
    app["settings"] = app_config
    app["static_directory"] = Path(__file__).parent.joinpath("static")
    app.router.add_routes([
        web.static("/static", app["static_directory"]),
        web.get("/favicon.ico", EmptyController),
        web.view("/ping", EmptyController),
        web.view("/echo", EmptyController),
        web.view("/mock", EmptyController),
        web.view("/{path:.*}", EmptyController)])
    web.run_app(app, host=args.host,
                path=args.path,
                port=args.port,
                access_log=log.access_logger)
