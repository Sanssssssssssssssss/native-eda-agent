# Packet switch from zero

Implement `z_packet_switch` from the supplied port-only shell. Target: Artix-7
`xc7a100tfgg676-2`, one 100 MHz clock. The fixed acceptance files are this
specification, `tb_z_packet_switch.sv`, and `clocks.xdc`.

## Interface

All signals are synchronous to the rising edge of `clk`. `rst` is synchronous,
active high. There are four inputs and four outputs. Port `i` occupies
`[i*W +: W]` in every packed bus of lane width `W`; bit `i` belongs to port `i`
on a four-bit valid/ready/last bus.

| Port | Direction | Width | Meaning |
| --- | --- | --- | --- |
| `clk`, `rst` | input | 1 each | Clock and synchronous reset |
| `clear_stats` | input | 1 | Synchronous counter clear; data continues |
| `s_data` | input | 256 | Four 64-bit input beats |
| `s_keep` | input | 32 | Four 8-bit byte-valid masks |
| `s_last` | input | 4 | Last beat of each input packet |
| `s_dest` | input | 8 | Four 2-bit output indices |
| `s_valid` | input | 4 | Each input offers a beat |
| `s_ready` | output | 4 | Each input can accept its offered beat |
| `m_data` | output | 256 | Four 64-bit output beats |
| `m_keep` | output | 32 | Four 8-bit byte-valid masks |
| `m_last` | output | 4 | Last beat of each output packet |
| `m_source` | output | 8 | Four 2-bit actual input-source indices |
| `m_valid` | output | 4 | Each output offers a beat |
| `m_ready` | input | 4 | Each downstream consumer accepts beats |
| `packet_count` | output | 128 | Four 32-bit unsigned packet counters |
| `byte_count` | output | 128 | Four 32-bit unsigned byte counters |

Only `valid && ready` at a rising edge transfers a beat. No input is accepted
when its valid is low, regardless of ready or changes on its other pins. The
source holds valid and its payload, keep, last, and destination while stalled.
Ready may depend on available capacity; no particular combinational-ready
implementation is required.

An output that has a beat to offer must assert `m_valid` independently of its
`m_ready`; it must not wait for downstream ready before presenting valid.
The allowed startup latency does not permit gating valid with ready.

`s_dest` is constant for all beats of a packet, whose final beat has `s_last=1`.
Packets have at least one beat and need not fit entirely in a FIFO. There is no
fixed packet-length limit. Each `keep` bit qualifies the corresponding byte of
data. All masks, including zero and noncontiguous masks, are legal on any beat.
Preserve keep, last, destination, source, and every data byte whose keep bit is
one. Data bytes with keep zero are unspecified, but the entire output beat must
remain stable while stalled.

Each input has a FIFO of at least 16 beats. No loss, duplication, misrouting,
or reordering within an input is allowed. Packets from the same input retain
their order even when their destinations change. Concurrent transfers on
different outputs are allowed when consistent with these input orders.

Each output independently arbitrates among inputs whose next packet targets
that output. Use round-robin packet arbitration. Once an output chooses a
packet, retain its source until that packet's last-beat handshake, including
input gaps and downstream stalls. Never interleave different packets on an
output. The round-robin pointer advances past the completed packet's source.
The initial pointer value is unspecified. `m_source` must identify the actual
input that supplied each beat.

If `m_valid[i] && !m_ready[i]`, the next sampled cycle must still have valid
asserted and identical data, keep, last, and source, unless reset intervenes.
An idle output has no required payload value. Unknown valid/ready values are
not permitted after reset; valid output payload/control must be known.

## Counters and reset

For each output, increment `byte_count` by the population count of keep on
every output handshake. Increment `packet_count` on output handshakes with
last set. Both counters wrap modulo 2^32. At an edge with `clear_stats=1`, all
counters become zero, taking priority over increments at that same edge;
transfers, FIFOs, and packet ownership proceed normally. Reset has highest
priority and empties all FIFOs, pending output beats, arbitration ownership,
and counters. Inputs are not accepted during reset. A packet interrupted by
reset is discarded; subsequent input starts a new packet. Output valid must
be zero after the reset edge.

## Performance and liveness

- In the absence of contention and output stalls, a continuously supplied
  stream of long packets must sustain one beat per output per cycle, including
  adjacent packet boundaries. An initial pipeline fill is allowed.
- The fixed throughput trial sends eight consecutive 48-beat packets per
  input, input `i` to output `i`. All four outputs are blocked for the first
  32 cycles, then stay ready. After a 16-cycle startup allowance, all four
  outputs must handshake on every cycle of a 256-cycle measurement window.
  The stimulus remains continuously valid until its packets are accepted.
- In a sustained one-beat-packet contest for any output, each input whose
  accepted head packet remains eligible must be served within 16 successful
  handshakes on that output. An interval in which that input has no accepted
  head packet does not count as continuous eligibility. Downstream stall
  cycles do not age this bound. The test also checks the cyclic round-robin
  successor when all four inputs have accepted eligible head packets.
- All valid offered traffic must eventually drain. A per-phase deadline and
  a global watchdog reject permanent backpressure and missing final beats.

## Fixed testbench

`tb_z_packet_switch` uses static arrays, deterministic xorshift stimuli, and
three fixed random seeds. Drivers change pins on falling edges. The monitor
samples handshakes on rising edges, then checks counters after a 1 ns delay
so DUT nonblocking updates have completed. It stores accepted beats in four
independent input queues; it does not predict a particular arbitration order
between inputs. Output source, destination, payload, packet ownership, and
input queue order are checked independently of the DUT implementation.

Trials cover:

- At least 16 accepted outstanding beats on every input while all outputs
  are stalled; deliberately changing invalid input pins checks phantom input.
- Four parallel sources, independent output stalls, packet lengths 1 through
  48, all destinations, partial and zero keep, and gaps within packets.
- Three random phases of 64 packets per input (768 complete packets alone).
- Output-zero congestion with 128 blocked cycles while the other three
  output streams must each complete at least 32 beats.
- Four fairness phases, each with 64 consecutive one-beat packets per input
  targeting one output; all four outputs exercise the fairness bound and
  round-robin rotation under complete eligibility.
- A 256-cycle, four-output saturated throughput window.
- Counter clear during live transfers and output stalls; stalled payload
  remains stable across clear. Mid-packet reset while outputs hold pending
  beats; each source offers a normal 48-beat packet, its output is blocked
  after the first handshake, and reset discards the remaining packet. The
  trial allows the entire input packet to be buffered before output begins.
  Fresh traffic must follow without replaying abandoned beats.

All failures use `$fatal(1, ...)`. Success emits exactly one summary:

```text
FROM_ZERO_PASS project=packet-switch packets=N beats=N protocol_checks=N
```

`packets` and `beats` count successfully checked output handshakes, across
counter-clear and reset epochs. `protocol_checks` counts actual monitor
assertions, not simulation cycles. A final accounting check reconciles all
accepted beats with emitted beats and beats deliberately discarded by reset.

The simulation oracle cannot establish physical FIFO implementation depth,
arbitrary packet lengths, counter rollover, exhaustive fairness for every
traffic pattern, clock-domain safety, post-route timing, or hardware behavior.
The blocked-input trial establishes observable capacity of at least 16 beats
per input, which can include an output staging register. Internal FIFO depth
must also be reviewed in the implemented RTL. This package contains no
functional reference DUT. Passing simulation is separate from synthesis,
setup/hold, DRC, routing, and board acceptance.
