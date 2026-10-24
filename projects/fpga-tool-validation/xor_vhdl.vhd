library ieee;
use ieee.std_logic_1164.all;
entity xor_vhdl is
  port(a, b : in std_logic; y : out std_logic);
end xor_vhdl;
architecture rtl of xor_vhdl is
begin
  y <= a xor b;
end rtl;
