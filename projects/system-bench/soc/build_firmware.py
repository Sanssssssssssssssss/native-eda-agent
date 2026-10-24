"""Build actual RV32IM C firmware and an independent host-side result oracle."""
import json, pathlib, struct, subprocess, zlib
ROOT=pathlib.Path(__file__).resolve().parents[3]
HERE=pathlib.Path(__file__).resolve().parent
zig=ROOT/'runtime/zig/ziglang/zig.exe'
cmd=[str(zig),'cc','-target','riscv32-freestanding','-mcpu=generic_rv32+m-a-c-d-f','-mabi=ilp32',
     '-O2','-ffreestanding','-fno-builtin','-nostdlib','-mno-relax',
     '-I'+str(ROOT/'vendor/picorv32/firmware'),'-Wl,-T,'+str(HERE/'link.ld'),
     str(HERE/'start.S'),str(HERE/'workload.c'),'-o',str(HERE/'firmware.elf')]
subprocess.run(cmd,check=True)
# ELF32 load segments, including explicit zero fill for BSS.
elf=(HERE/'firmware.elf').read_bytes()
assert elf[:5]==b'\x7fELF\x01' and elf[5]==1
phoff=struct.unpack_from('<I',elf,28)[0]; entsize,count=struct.unpack_from('<HH',elf,42)
image=bytearray(65536)
for i in range(count):
    typ,off,vaddr,paddr,filesz,memsz,flags,align=struct.unpack_from('<8I',elf,phoff+i*entsize)
    if typ==1:
        assert paddr+memsz<=len(image)
        image[paddr:paddr+filesz]=elf[off:off+filesz]
(HERE/'firmware.hex').write_text(''.join(f'{w[0]:08x}\n' for w in struct.iter_unpack('<I',image)))
mask=0xffffffff
def oracle(seed):
    x=seed
    def nextval():
        nonlocal x
        x=(x*1664525+1013904223)&mask
        return x
    data=bytes(nextval()>>24 for _ in range(4096))
    ordered=sorted(nextval() for _ in range(128))
    def hashvals(values):
        h=0
        for v in values:h=(h*33+v)&mask
        return h
    a=[];b=[]
    for _ in range(256):a.append((nextval()>>27)-16);b.append((nextval()>>27)-16)
    c=[sum(a[i*16+k]*b[k*16+j] for k in range(16)) for i in range(16) for j in range(16)]
    mem=[((seed^(i*0x01020304))&255)|(i<<8)|(((i^seed)&65535)<<16) for i in range(256)]
    div=0
    for i in range(1,129):v=nextval();div=(div+((v//i)^(v%i)))&mask
    return [zlib.crc32(data),hashvals(ordered),hashvals(c),hashvals(mem),div]
seeds=[1,0x12345678,0xdeadbeef,0xffffffff,0,0x80000000,0x31415926,0xabcdef01]
(HERE/'expected.hex').write_text(''.join(f'{v:08x}\n' for s in seeds for v in oracle(s)))
(HERE/'firmware-build.json').write_text(json.dumps({'command':cmd,'compiler':'Zig 0.14.1 clang','seeds':seeds,'expected':[oracle(s) for s in seeds]},indent=2))
print('Firmware built, independent Python oracle ready')
