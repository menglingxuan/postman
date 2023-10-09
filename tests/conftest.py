# -*- encoding: utf-8 -*-


import pytest

from pathlib import Path
from _pytest.main import Parser
from _pytest.config import Config
from _pytest.fixtures import SubRequest
from .newman import NewmanOutput, CollectionBuilder


@pytest.hookimpl
def pytest_addoption(parser: Parser):
    parser.addini(
        name="collection_file",
        type="string",
        help="postman collection exported file"
             "( v2.1 format ), relative to rootdir"
    )


@pytest.fixture
def _collection_built(request: SubRequest, pytestconfig: Config) -> Path:
    test_method = request.function
    test_scene: CollectionBuilder = getattr(test_method, "_pytest_scene", None)
    if test_scene is None:
        raise AttributeError(f"@{test_method.__name__}(): no registered scene for this test")
    built: Path = test_scene.to_file(pytestconfig.rootpath / "tmp_files")
    return built


@pytest.fixture(autouse=True)
def newman_output(_collection_built) -> NewmanOutput:
    collection = _collection_built
    wrapped_out = NewmanOutput.run(collection)
    return wrapped_out
