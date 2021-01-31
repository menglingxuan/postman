# -*- encoding: utf-8 -*-


import base64
import re

from Crypto.Cipher import AES
from Crypto.Hash import SHA256
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Util.Padding import unpad

from typing import *

from aiohttp.typedefs import LooseHeaders
from aiohttp.web import Response, json_response


__all__ = [
    "FeatureError",
    "Feature",
    "decrypt",

    "Response",
    "json_response",
    "text_response",
]


class _AESDecrypter(object):
    @staticmethod
    def _urlsafe_base64_decode(urlsafe_base64: str):
        std_base64 = urlsafe_base64.encode('ascii')
        std_base64 = std_base64.translate(bytes.maketrans(b'-_', b'+/'))
        while len(std_base64) % 4:
            std_base64 += b"="
        return base64.b64decode(std_base64)

    @staticmethod
    def _create_iv(secret: str, salt: bytes):
        key_iv: bytes = PBKDF2(secret, salt, dkLen=int(512/8), count=1000, hmac_hash_module=SHA256)
        key_iv: str = key_iv.hex()
        return key_iv[0:64], key_iv[63:95]

    @staticmethod
    def decrypt(encrypted: str):
        ciphertext: bytes = _AESDecrypter._urlsafe_base64_decode(encrypted)
        ciphertext, salt = (ciphertext[:-8], ciphertext[-8:])
        key, iv = _AESDecrypter._create_iv(FEATURE_AES_TOKEN, salt)
        cipher = AES.new(bytearray.fromhex(key), AES.MODE_CBC, iv=bytearray.fromhex(iv))
        plain_text: bytes = unpad(cipher.decrypt(ciphertext), 16)
        return plain_text.decode()


FEATURE_AES_TOKEN = "thisIsToken"
FEATURE_COOKIE_PREFIX = "X-POSTMAN-DATA-"


class FeatureError(Exception):
    pass


class Feature(object):
    def __init__(self, data):
        self.data = data

    async def feature(self) -> Response:
        raise FeatureError("not implemented feature")


async def decrypt(cookies) -> Response:
    def _get_args():
        nonlocal cookies
        args = [None] * len(cookies)
        for i, key in enumerate(cookies.keys()):
            if not key.startswith(FEATURE_COOKIE_PREFIX):
                continue
            [_, index] = key.split(FEATURE_COOKIE_PREFIX)
            if re.search(r"^[0-9]+$", index) is None:
                continue
            args[int(index)] = cookies.get(key)
        args = list(filter(None, args))
        if not len(args):
            raise FeatureError("请求未包含有效的cookie信息")
        return "".join(args)

    encrypted = _get_args()
    text = _AESDecrypter.decrypt(encrypted)

    name, data = text.split(",", 1)
    try:
        module = __import__(f"features.{name}", fromlist=["FeatureCls"], level=0)
    except ImportError as error:
        raise FeatureError(f"not implemented feature: {name}")
    else:
        feature_cls = module.FeatureCls
        response = await feature_cls(data).feature()
        return response


def text_response(
    *,
    text: Optional[str] = None,
    body: Optional[bytes] = None,
    status: int = 200,
    reason: Optional[str] = None,
    headers: Optional[LooseHeaders] = None,
    content_type: str = "text/plain",
) -> Response:
    return Response(
        text=text,
        body=body,
        status=status,
        reason=reason,
        headers=headers,
        content_type=content_type
    )
