# -*- encoding: utf-8 -*-


import pytest

from pathlib import Path


cur_dir = Path(__file__).parent

pytest.main([
    "--show-capture=all",
    "--capture=tee-sys",
    # "--cache-show",
    "--",
    cur_dir / "cases"], None)
