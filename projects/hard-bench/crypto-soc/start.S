#include "custom_ops.S"
.section .text.start
.global _start
_start:
    j boot
.balign 16
irq_vector:
    picorv32_setq_insn(q2,t0)
    picorv32_setq_insn(q3,t1)
    li t0,0x10000014
    li t1,1
    sw t1,0(t0)
    la t0,irq_seen
    lw t1,0(t0)
    addi t1,t1,1
    sw t1,0(t0)
    picorv32_getq_insn(t0,q2)
    picorv32_getq_insn(t1,q3)
    picorv32_retirq_insn()
boot:
    li sp,0x10000
    la t0,__bss_start
    la t1,__bss_end
1:  bgeu t0,t1,2f
    sw zero,0(t0)
    addi t0,t0,4
    j 1b
2:  li a0,-17
    picorv32_maskirq_insn(zero,a0)
    call main
3:  j 3b
