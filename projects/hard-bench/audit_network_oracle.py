"""Independently validate the committed GMII fixture bytes; no generator imports."""
import hashlib
import json
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[2]
D = ROOT / 'projects/hard-bench/ethernet-cdc'
OUT = ROOT / 'artifacts/hard-bench-assessment-20261023'


def crc_bits(data):
    c = 0xffffffff
    for byte in data:
        c ^= byte
        for _ in range(8):
            c = (c >> 1) ^ (0xedb88320 if c & 1 else 0)
    return c ^ 0xffffffff


def ones_sum(data):
    if len(data) % 2:
        data += bytes(1)
    acc = sum(int.from_bytes(data[i:i+2], 'big') for i in range(0, len(data), 2))
    while acc >> 16:
        acc = (acc & 65535) + (acc >> 16)
    return acc


tb = (D / 'tb_a.sv').read_text()
stats = {'frames': 0, 'ipv4_headers': 0, 'udp_checksums': 0, 'arp_frames': 0}
hashes = {}


def load(name, prefix):
    file = D / f'{name}.hex'
    data = bytes(int(word, 16) for word in file.read_text().split())
    hashes[file.name] = hashlib.sha256(file.read_bytes()).hexdigest()
    offsets = [int(x) for x in re.findall(prefix + r'o\[\d+\]=(\d+);', tb)]
    lengths = [int(x) for x in re.findall(prefix + r'l\[\d+\]=(\d+);', tb)]
    assert len(offsets) == len(lengths) and offsets[0] == 0
    assert offsets[-1] + lengths[-1] == len(data)
    frames = []
    for n, (offset, length) in enumerate(zip(offsets, lengths)):
        if n:
            assert offsets[n-1] + lengths[n-1] == offset
        frame = data[offset:offset+length]
        assert frame[:8] == b'\x55' * 7 + b'\xd5', (name, n, 'preamble')
        body = frame[8:-4]
        assert len(body) >= 60
        assert crc_bits(body) == int.from_bytes(frame[-4:], 'little'), (name, n, 'FCS')
        stats['frames'] += 1
        if body[12:14] == b'\x08\x00':
            ip = body[14:]
            header_len = (ip[0] & 15) * 4
            total = int.from_bytes(ip[2:4], 'big')
            assert header_len == 20 and total <= len(ip) and ip[9] == 17
            assert ones_sum(ip[:header_len]) == 65535, (name, n, 'IPv4 checksum')
            udp = ip[header_len:total]
            assert int.from_bytes(udp[4:6], 'big') == len(udp)
            assert ones_sum(ip[12:20] + bytes([0, 17]) + len(udp).to_bytes(2, 'big') + udp) == 65535
            stats['ipv4_headers'] += 1
            stats['udp_checksums'] += 1
        else:
            assert body[12:14] == b'\x08\x06'
            assert body[14:22] == bytes.fromhex('0001080006040001')
            assert body[22:32] == bytes.fromhex('020000000001c0a8010a')
            assert body[32:42] == bytes.fromhex('000000000000c0a80114')
            stats['arp_frames'] += 1
        frames.append(body)
    return frames


incoming = load('valid', 'v')
expected = load('expected', 'e')
outgoing = [f for f in expected if f[12:14] == b'\x08\x00']
assert len(incoming) == len(outgoing) == 281
for a, b in zip(incoming, outgoing):
    assert a[:6] == b[6:12] and a[6:12] == b[:6]
    ai, bi = a[14:], b[14:]
    assert ai[12:16] == bi[16:20] and ai[16:20] == bi[12:16]
    assert ai[20:22] == bi[22:24] and ai[22:24] == bi[20:22]
    assert ai[28:int.from_bytes(ai[2:4], 'big')] == bi[28:int.from_bytes(bi[2:4], 'big')]
stats['echo_payloads_and_address_swaps'] = len(incoming)
result = {'pass': True, 'checks': stats, 'fixture_sha256': hashes,
          'method': 'Root audit: independent bit-at-a-time CRC32 and ones-complement checksum; no generator imports. Checks oracle fixture validity, not an additional hardware simulation.'}
OUT.mkdir(exist_ok=True)
(OUT / 'network-oracle-audit.json').write_text(json.dumps(result, indent=2))
print(json.dumps(result, indent=2))
