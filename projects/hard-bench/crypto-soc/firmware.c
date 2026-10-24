typedef unsigned int u32;
typedef unsigned char u8;
#include "oracle.h"
#define REG(offset) (*(volatile u32 *)(0x10000000u+(offset)))
typedef struct {u32 src,dst,len,key,iv,flags,next,cookie;} descriptor;
volatile u32 irq_seen;
static u32 work_rounds,entropy=0x12345678;
static void emit(u32 tag,u32 value){REG(0x24)=tag;REG(0x20)=value;}
static void fail(u32 code){REG(0x28)=code;for(;;){}}
static u32 crc32(volatile u8 *p,u32 n){
    u32 c=0xffffffff;
    for(u32 i=0;i<n;i++)c=(c>>8)^crc_table[(c^p[i])&255];
    return ~c;
}
static void wait_irq(u32 previous){
    u32 rounds=0;
    volatile u32 *scratch=(volatile u32 *)0xc000;
    while(irq_seen==previous){
        if(REG(0x0c)&1){
            u32 slot=work_rounds&255;
            entropy=(entropy*1664525u+1013904223u)/((work_rounds&31)+1);
            scratch[slot]=entropy;
            // This RAM CRC work really competes with DMA through the arbiter.
            entropy^=crc32((volatile u8 *)&scratch[slot],4);
            work_rounds++;
        }
        if(++rounds>200000)fail(0xbad10000);
    }
}
static void begin(u32 ptr){REG(0x04)=ptr;REG(0x08)=1;}
static void bad_then_irq(u32 number){
    volatile descriptor *d=(volatile descriptor *)0x4000;
    *d=(descriptor){0x6000,0x9000,32,0x5000,0x5100,0,0,0xe000+number};
    u32 expected_error=number+1,ptr=0x4000;
    if(number==0)ptr=0x4002;
    if(number==1)d->len=0;
    if(number==2)d->src=0xfffffff0;
    if(number==3)d->next=0x4002;
    if(number==4)d->dst=0x6004;
    if(number==5)d->flags=7;
    if(number==6){d->next=0x4000;expected_error=6;}
    u32 before=irq_seen,bytes=REG(0x1c);
    begin(ptr);wait_irq(before);
    if((REG(0x0c)>>8)!=expected_error || (REG(0x0c)&1))fail(0xbade0000+number);
    if(REG(0x10)!=(number==6?16u:0u))fail(0xbade1000+number);
    if(REG(0x1c)-bytes!=(number==6?512u:0u))fail(0xbade2000+number);
    emit(100+number,expected_error);
}
static void prepare_case(u32 number,u32 seed,u32 slot){
    u32 length=case_lengths[number];
    u32 src=0x6000+slot*0x1200,dst=0x9000+slot*0x1200;
    u32 kp=0x5000+slot*0x40,ip=0x5100+slot*0x20;
    volatile u8 *in=(volatile u8 *)src,*out=(volatile u8 *)dst;
    volatile u8 *key=(volatile u8 *)kp,*iv=(volatile u8 *)ip;
    for(u32 i=0;i<32;i++)key[i]=(seed>>((i&3)*8))^(number*29+i*17+3);
    for(u32 i=0;i<16;i++)iv[i]=(seed>>((i&3)*8))+number*11+i*7;
    // Counter rollover during the last long-enough descriptor.
    if(number==11){for(u32 i=0;i<15;i++)iv[i]=255;iv[15]=240;}
    for(u32 i=0;i<length;i++)in[i]=(i*73+(i>>3)*19+number*31)^(seed>>((i&3)*8));
    for(u32 i=0;i<length+8;i++)out[i]=0xa5;
    for(u32 i=1;i<=4;i++)out[-(int)i]=0xa5;
    volatile descriptor *d=(volatile descriptor *)(0x4000+slot*32);
    *d=(descriptor){src,dst,length,kp,ip,slot,slot?0:0x4020,number};
}
int main(void){
    u32 seed=REG(0x00),seed_index=3;
    for(u32 i=0;i<3;i++)if(seeds[i]==seed)seed_index=i;
    if(seed_index==3)fail(0xbad50000);
    for(u32 group=0;group<7;group++){
        bad_then_irq(group);
        prepare_case(group*2,seed,0);prepare_case(group*2+1,seed,1);
        u32 before=irq_seen,bytes=REG(0x1c);
        begin(0x4000);
        if(group==0)REG(0x08)=1; // Busy submission must be counted and ignored.
        wait_irq(before);
        if((REG(0x0c)>>8)!=0||REG(0x10)!=2||REG(0x40)!=group*2+1)fail(0xbad20000+group);
        if(REG(0x1c)-bytes!=case_lengths[group*2]*2)fail(0xbad21000+group);
        for(u32 slot=0;slot<2;slot++){
            u32 number=group*2+slot,n=case_lengths[number];
            volatile u8 *dst=(volatile u8 *)(0x9000+slot*0x1200);
            volatile u8 *src=(volatile u8 *)(0x6000+slot*0x1200);
            u32 actual=crc32(dst,n);
            if(actual!=expected_crc[seed_index][number])fail(0xbadc0000+number);
            if(crc32(src,n)!=plain_crc[seed_index][number])fail(0xbadc1000+number);
            for(u32 j=0;j<8;j++)if(dst[n+j]!=0xa5)fail(0xbad30000+number);
            for(u32 j=1;j<=4;j++)if(dst[-(int)j]!=0xa5)fail(0xbad31000+number);
            emit(number,actual);
        }
    }
    if(REG(0x18)!=1||irq_seen!=14||REG(0x30)!=14)fail(0xbad40000);
    if(REG(0x34)<100||REG(0x38)<10||REG(0x3c)<10||work_rounds<10)fail(0xbad41000);
    REG(0x2c)=work_rounds;
    emit(200,work_rounds);emit(201,irq_seen);emit(202,REG(0x18));emit(203,REG(0x1c));
    REG(0x28)=0x600dcafe;
    for(;;){}
}
