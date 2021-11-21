# -*- encoding: utf-8 -*-


__all__ = [
    "AESDecrypter"
]


import base64

from Crypto.Cipher import AES
from Crypto.Hash import SHA256
from Crypto.Protocol.KDF import PBKDF2
from Crypto.Util.Padding import unpad


class AESDecrypter(object):
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
    def decrypt(token: str, encrypted: str):
        ciphertext: bytes = AESDecrypter._urlsafe_base64_decode(encrypted)
        ciphertext, salt = (ciphertext[:-8], ciphertext[-8:])
        key, iv = AESDecrypter._create_iv(token, salt)
        cipher = AES.new(bytearray.fromhex(key), AES.MODE_CBC, iv=bytearray.fromhex(iv))
        plain_text: bytes = unpad(cipher.decrypt(ciphertext), 16)
        return plain_text.decode()
