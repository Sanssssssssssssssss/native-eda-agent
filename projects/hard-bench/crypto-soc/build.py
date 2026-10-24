"""Build real RV32IM firmware and independent full-byte AES-CTR references."""
import hashlib,json,pathlib,struct,subprocess,zlib
from cryptography.hazmat.primitives.ciphers import Cipher,algorithms,modes
HERE=pathlib.Path(__file__).resolve().parent
ROOT=HERE.parents[2]
SEEDS=[1,0x12345678,0xdeadbeef]
LENGTHS=[n for n in [4093,1,15,16,17,257,33] for _ in range(2)]
expected=[];crcs=[];plain_crcs=[];offsets=[]
for seed in SEEDS:
    cc=[];pc=[]
    for case,n in enumerate(LENGTHS):
        key=bytes(((seed>>((i&3)*8))^(case*29+i*17+3))&255 for i in range(32 if case&1 else 16))
        iv=bytes(((seed>>((i&3)*8))+case*11+i*7)&255 for i in range(16))
        if case==11:iv=bytes([255]*15+[240])
        data=bytes(((i*73+(i>>3)*19+case*31)^(seed>>((i&3)*8)))&255 for i in range(n))
        enc=Cipher(algorithms.AES(key),modes.CTR(iv)).encryptor()
        cipher=enc.update(data)+enc.finalize()
        dec=Cipher(algorithms.AES(key),modes.CTR(iv)).decryptor()
        assert dec.update(cipher)+dec.finalize()==data
        offsets.append(len(expected));expected.extend(cipher)
        cc.append(zlib.crc32(cipher));pc.append(zlib.crc32(data))
    crcs.append(cc);plain_crcs.append(pc)
table=[]
for i in range(256):
    c=i
    for _ in range(8):c=(c>>1)^(0xedb88320 if c&1 else 0)
    table.append(c)
arr=lambda values:','.join(f'0x{v:08x}u' for v in values)
(HERE/'oracle.h').write_text('static const u32 seeds[3]={'+arr(SEEDS)+'};\n'
    'static const u32 case_lengths[14]={'+arr(LENGTHS)+'};\n'
    'static const u32 crc_table[256]={'+arr(table)+'};\n'
    'static const u32 expected_crc[3][14]={'+','.join('{'+arr(a)+'}' for a in crcs)+'};\n'
    'static const u32 plain_crc[3][14]={'+','.join('{'+arr(a)+'}' for a in plain_crcs)+'};\n')
(HERE/'expected-bytes.hex').write_text(''.join(f'{b:02x}\n' for b in expected))
(HERE/'expected-crc.hex').write_text(''.join(f'{v:08x}\n' for row in crcs for v in row))
(HERE/'expected-offsets.hex').write_text(''.join(f'{v:08x}\n' for v in offsets))
(HERE/'case-lengths.hex').write_text(''.join(f'{v:08x}\n' for v in LENGTHS))
cmd=[str(ROOT/'runtime/zig/ziglang/zig.exe'),'cc','-target','riscv32-freestanding',
    '-mcpu=generic_rv32+m-a-c-d-f','-mabi=ilp32','-O2','-ffreestanding','-fno-builtin','-nostdlib','-mno-relax',
    '-I'+str(ROOT/'vendor/picorv32/firmware'),'-Wl,-T,'+str(HERE/'link.ld'),
    str(HERE/'start.S'),str(HERE/'firmware.c'),'-o',str(HERE/'firmware.elf')]
subprocess.run(cmd,check=True)
elf=(HERE/'firmware.elf').read_bytes();image=bytearray(65536)
phoff=struct.unpack_from('<I',elf,28)[0];entsize,count=struct.unpack_from('<HH',elf,42)
for i in range(count):
    typ,off,vaddr,paddr,filesz,memsz,flags,align=struct.unpack_from('<8I',elf,phoff+i*entsize)
    if typ==1:
        assert paddr+memsz<=0x4000
        image[paddr:paddr+filesz]=elf[off:off+filesz]
(HERE/'firmware.hex').write_text(''.join(f'{w[0]:08x}\n' for w in struct.iter_unpack('<I',image)))
sources=['vendor/picorv32/picorv32.v']+[f'vendor/aes/src/rtl/{n}.v' for n in
    ['aes_core','aes_encipher_block','aes_decipher_block','aes_key_mem','aes_sbox','aes_inv_sbox']]+[
    f'projects/hard-bench/crypto-soc/{n}.sv' for n in ['shared_ram','ctr_dma','crypto_soc_top']]
(HERE/'sources.json').write_text(json.dumps({'top':'crypto_soc_top','sources':sources},indent=2))
(HERE/'sim_sources.sv').write_text('`timescale 1ns/1ps\n'+''.join(f'`include "{(ROOT/s).as_posix()}"\n' for s in sources))
(HERE/'sim.json').write_text(json.dumps({'sources':['projects/hard-bench/crypto-soc/sim_sources.sv',
    'projects/hard-bench/crypto-soc/tb_crypto_soc.sv'],'top':'tb_crypto_soc','capture_top_wave':True},indent=2))
(HERE/'impl.json').write_text(json.dumps({'script':'projects/hard-bench/crypto-soc/implement.tcl'}))
(HERE/'implement.tcl').write_text('set root $::env(EDA_WORKSPACE)\nset_param general.maxThreads 2\nset_param synth.maxThreads 1\n'+
    ''.join('read_verilog -sv [file join $root '+s.replace('/',' ')+']\n' for s in sources)+
    'set top crypto_soc_top\nsource [file join $root projects system-bench implement-common.tcl]\n')
manifest={'project':'crypto-soc','seeds':SEEDS,'case_lengths':LENGTHS,'valid_descriptors_per_seed':14,
    'validated_ciphertext_bytes_per_seed':sum(LENGTHS),'validated_ciphertext_bytes_total':len(expected),
    'error_cases':['unaligned descriptor','zero length','33-bit address overflow','unaligned next',
        'partial overlap','invalid flags','descriptor cycle limit'],
    'error_recovery_chains_per_seed':7,'actual_cpu':'PicoRV32 RV32IM with IRQ','compiler_command':cmd,
    'oracle':'cryptography AES CTR plus zlib CRC32','source_files':sources,
    'upstreams':{n:subprocess.check_output(['git','-C',str(ROOT/'vendor'/n),'rev-parse','HEAD'],text=True).strip()
        for n in ['picorv32','aes']},
    'source_sha256':{p:hashlib.sha256((ROOT/p).read_bytes()).hexdigest() for p in sources},
    'firmware_sha256':hashlib.sha256((HERE/'firmware.hex').read_bytes()).hexdigest(),
    'oracle_sha256':hashlib.sha256((HERE/'expected-bytes.hex').read_bytes()).hexdigest()}
(HERE/'manifest.json').write_text(json.dumps(manifest,indent=2))
print(f'Built RV32IM firmware, {len(expected)} independent ciphertext bytes, 42 descriptors / 21 error-recovery chains')
