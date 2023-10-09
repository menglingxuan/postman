# -*- encoding: utf-8 -*-


from ..newman import *


@collection.add_request(
    method=methods.METHOD_GET,
    url=defaults.url
)
def test_app_main(newman_output):
    print(newman_output)
    assert True
