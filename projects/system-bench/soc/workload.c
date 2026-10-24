typedef unsigned int u32;
typedef unsigned short u16;
typedef unsigned char u8;
#define IO(n) (*(volatile u32 *)(0x10000000u+(n)))
static u8 data[4096];
static u32 sorted[128];
static int a[256],b[256],c[256];
static volatile u32 memtest[256];
static u32 next(u32 x) { return x*1664525u+1013904223u; }
int main(void) {
 u32 seed=IO(0), x=seed, crc=~0u, hash=0, sum=0;
 for(int i=0;i<4096;i++){x=next(x);data[i]=x>>24;}
 for(int i=0;i<4096;i++) {
   crc^=data[i]; for(int j=0;j<8;j++) crc=(crc>>1)^((0u-(crc&1u))&0xedb88320u);
 }
 IO(4)=~crc;
 for(int i=0;i<128;i++){x=next(x);sorted[i]=x;}
 for(int i=1;i<128;i++){u32 v=sorted[i];int j=i;while(j>0&&sorted[j-1]>v){sorted[j]=sorted[j-1];j--;}sorted[j]=v;}
 for(int i=0;i<128;i++)hash=hash*33u+sorted[i];
 IO(4)=hash;
 for(int i=0;i<256;i++){x=next(x);a[i]=(int)(x>>27)-16;x=next(x);b[i]=(int)(x>>27)-16;}
 for(int i=0;i<16;i++)for(int j=0;j<16;j++){int v=0;for(int k=0;k<16;k++)v+=a[i*16+k]*b[k*16+j];c[i*16+j]=v;}
 hash=0;for(int i=0;i<256;i++)hash=hash*33u+(u32)c[i]; IO(4)=hash;
 for(int i=0;i<256;i++){
   memtest[i]=seed^(u32)i*0x01020304u;
   ((volatile u8*)memtest)[4*i+1]=(u8)i;
   ((volatile u16*)memtest)[2*i+1]=(u16)(i^seed);
 }
 hash=0;for(int i=0;i<256;i++)hash=hash*33u+memtest[i];IO(4)=hash;
 for(u32 i=1;i<129;i++){x=next(x);sum+=(x/i)^(x%i);}
 IO(4)=sum;
 IO(4)=IO(16);
 IO(8)=0x600dcafeu;
 return 0;
}
