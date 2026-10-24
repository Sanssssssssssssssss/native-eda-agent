ENTRY(_start)
SECTIONS {
 . = 0;
 .text : { *(.text.start) *(.text*) }
 .rodata : { *(.rodata*) }
 .data : { *(.data*) *(.sdata*) }
 . = ALIGN(4);
 __bss_start = .;
 .bss : { *(.bss*) *(.sbss*) *(COMMON) }
 . = ALIGN(4);
 __bss_end = .;
 ASSERT(__bss_end < 0x4000, "Firmware overlaps descriptor RAM")
}
