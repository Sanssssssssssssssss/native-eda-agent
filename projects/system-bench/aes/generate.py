"""Frozen independent AES oracle: cryptography/OpenSSL plus published NIST KATs."""
import hashlib, json, pathlib, random, subprocess, sys, re
import cryptography
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE.parent))
from prepare import prepare

def encrypt(key, block):
    op = Cipher(algorithms.AES(key), modes.ECB()).encryptor()
    return op.update(block) + op.finalize()

def decrypt(key, block):
    op = Cipher(algorithms.AES(key), modes.ECB()).decryptor()
    return op.update(block) + op.finalize()

groups = []
plain = bytes.fromhex('00112233445566778899aabbccddeeff')
for bits, known in [(128,'69c4e0d86a7b0430d8cdb78070b4c55a'),
                    (256,'8ea2b7ca516745bfeafc49904b496089')]:
    key = bytes(range(bits//8))
    cipher = bytes.fromhex(known)
    assert encrypt(key,plain) == cipher and decrypt(key,cipher) == plain
    groups.append(('FIPS197-AES'+str(bits), key, [(1,plain,cipher),(0,cipher,plain)]))

blocks = [bytes.fromhex(x) for x in [
    '6bc1bee22e409f96e93d7e117393172a', 'ae2d8a571e03ac9c9eb76fac45af8e51',
    '30c81c46a35ce411e5fbc1191a0a52ef', 'f69f2445df4f9b17ad2b417be66c3710']]
for kh, expected in [
    ('2b7e151628aed2a6abf7158809cf4f3c', ['3ad77bb40d7a3660a89ecaf32466ef97',
      'f5d3d58503b9699de785895a96fdbaaf','43b1cd7f598ece23881b00e3ed030688',
      '7b0c785e27e8ad3f8223207104725dd4']),
    ('603deb1015ca71be2b73aef0857d77811f352c073b6108d72d9810a30914dff4',
     ['f3eed1bdb5d2a03c064b5a7e3db181f8','591ccb10d410ed26dc5ba74a31362870',
      'b6ed21b99ca6f4f9f153e7b1beafed1d','23304b7a39f9f3ff067d8d8f9e24ecc7'])]:
    key = bytes.fromhex(kh)
    vectors=[]
    for p,ch in zip(blocks,expected):
        c=bytes.fromhex(ch)
        assert encrypt(key,p)==c and decrypt(key,c)==p
        vectors.extend([(1,p,c),(0,c,p)])
    groups.append(('SP800-38A-AES'+str(len(key)*8),key,vectors))

rng=random.Random(0xEDA20261023)
for group in range(16):
    key=rng.randbytes(16 if group%2==0 else 32)
    vectors=[]
    for block in range(16):
        p=(bytes(16) if block==0 else bytes([255])*16 if block==1 else rng.randbytes(16))
        c=encrypt(key,p)
        assert decrypt(key,c)==p
        vectors.extend([(1,p,c),(0,c,p)])
    groups.append((f'Random-{group:02d}',key,vectors))

lines=[]
manifest=[]
for g,(name,key,vectors) in enumerate(groups):
    start=len(lines)
    for i,(enc,inp,out) in enumerate(vectors):
        packed=key.hex().ljust(64,'0')
        lines.append(f'{packed} {int(len(key)==32)} {enc} {inp.hex()} {out.hex()} {len(lines):04x} {int(i==len(vectors)-1)} {g}\n')
    manifest.append({'group':g,'name':name,'key_bits':len(key)*8,'start':start,'count':len(vectors)})
(HERE/'vectors.txt').write_text(''.join(lines),encoding='ascii')
(HERE/'vector-config.svh').write_text(
    f'localparam integer VECTOR_COUNT = {len(lines)};\n'
    f'localparam integer GROUP_COUNT = {len(groups)};\n'
    f'localparam VECTOR_FILE = "{(HERE/"vectors.txt").as_posix()}";\n',encoding='ascii')
rtl=['aes_core','aes_encipher_block','aes_decipher_block','aes_key_mem','aes_sbox','aes_inv_sbox']
sources=[f'vendor/aes/src/rtl/{n}.v' for n in rtl]+['projects/system-bench/aes/aes_stream_top.sv']
prepare('aes','aes_stream_top',sources)
# Limit synthesis helper concurrency on this memory-constrained Windows host.
# Installation Tcl read failures were observed; the root cause is not proven.
impl=(HERE/'implement.tcl').read_text()
(HERE/'implement.tcl').write_text(impl.replace('set_param general.maxThreads 2',
    'set_param general.maxThreads 2\nset_param synth.maxThreads 1\n'
    'foreach relative {scripts/rt/fpga_tcl/rtSynthParallelPrep.tcl scripts/rt/data/unimacro/unimacro_vhdl.tcl scripts/rt/data/unimacro/unimacro_verilog.tcl} {\n'
    '  set dependency [file join $::env(XILINX_VIVADO) $relative]\n'
    '  set handle [open $dependency r]\n'
    '  set bytes [string length [read $handle]]\n'
    '  close $handle\n'
    '  puts "AES_TOOL_PREFLIGHT path=$dependency bytes=$bytes"\n'
    '}'))
# Compile the unmodified upstream files in a unit with an explicit time unit.
# XSim 2020.2 rejects mixed timed/untimed compilation units at elaboration.
(HERE/'aes_sim_sources.sv').write_text('`timescale 1ns/1ps\n'+''.join(
    f'`include "{(ROOT/s).as_posix()}"\n' for s in sources),encoding='ascii')
sim=json.loads((HERE/'sim.json').read_text())
sim['sources']=['projects/system-bench/aes/aes_sim_sources.sv','projects/system-bench/aes/tb_aes.sv']
(HERE/'sim.json').write_text(json.dumps(sim,indent=2))
manifest_data={'upstream':'https://github.com/secworks/aes',
    'commit':subprocess.check_output(['git','-C',str(ROOT/'vendor/aes'),'rev-parse','HEAD'],text=True).strip(),
    'license':'BSD-2-Clause','oracle':f'cryptography {cryptography.__version__} AES ECB',
    'random_seed':'0xEDA20261023','blocks':len(lines),'encryption_blocks':len(lines)//2,
    'decryption_blocks':len(lines)//2,'groups':manifest,
    'vectors_sha256':hashlib.sha256((HERE/'vectors.txt').read_bytes()).hexdigest(),
    'synthesized_source_files':sources,
    'synthesized_source_lines':sum(len((ROOT/s).read_text().splitlines()) for s in sources),
    'synthesized_noncomment_nonblank_lines':sum(sum(bool(line.strip()) for line in
        re.sub(r'//[^\n]*|/\*.*?\*/','',(ROOT/s).read_text(),flags=re.S).splitlines()) for s in sources),
    'synthesized_module_definitions':len(sources),
    'source_sha256':{s:hashlib.sha256((ROOT/s).read_bytes()).hexdigest() for s in sources},
    'references':['https://nvlpubs.nist.gov/nistpubs/FIPS/NIST.FIPS.197-upd1.pdf',
                  'https://nvlpubs.nist.gov/nistpubs/Legacy/SP/nistspecialpublication800-38a.pdf']}
(HERE/'manifest.json').write_text(json.dumps(manifest_data,indent=2))
print(json.dumps({k:v for k,v in manifest_data.items() if k not in ('groups','synthesized_source_files')},indent=2))
