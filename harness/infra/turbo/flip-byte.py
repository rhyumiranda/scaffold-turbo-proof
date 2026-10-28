#!/usr/bin/env python3
"""Flips one bit in the middle of a stored cache artifact. Usage: flip-byte.py FILE"""
import hashlib, sys
path = sys.argv[1]
data = bytearray(open(path, "rb").read())
print("artifact", path, "length", len(data), "before_sha256", hashlib.sha256(data).hexdigest())
data[len(data) // 2] ^= 1
open(path, "wb").write(data)
print("after_sha256", hashlib.sha256(data).hexdigest())
