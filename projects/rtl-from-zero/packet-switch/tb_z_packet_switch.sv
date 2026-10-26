`timescale 1ns/1ps
module tb_z_packet_switch;
    localparam integer Q_DEPTH = 32768;
    localparam integer MODE_CAPACITY = 1;
    localparam integer MODE_RANDOM = 2;
    localparam integer MODE_CONGEST = 3;
    localparam integer MODE_FAIR = 4;
    localparam integer MODE_THROUGHPUT = 5;
    localparam integer MODE_RESET = 6;

    reg clk = 0;
    always #5 clk = ~clk;
    reg rst = 1;
    reg clear_stats = 0;
    reg [255:0] s_data = 0;
    reg [31:0] s_keep = 0;
    reg [3:0] s_last = 0;
    reg [7:0] s_dest = 0;
    reg [3:0] s_valid = 0;
    wire [3:0] s_ready;
    wire [255:0] m_data;
    wire [31:0] m_keep;
    wire [3:0] m_last;
    wire [7:0] m_source;
    wire [3:0] m_valid;
    reg [3:0] m_ready = 0;
    wire [127:0] packet_count;
    wire [127:0] byte_count;

    z_packet_switch dut (
        .clk(clk), .rst(rst), .clear_stats(clear_stats),
        .s_data(s_data), .s_keep(s_keep), .s_last(s_last),
        .s_dest(s_dest), .s_valid(s_valid), .s_ready(s_ready),
        .m_data(m_data), .m_keep(m_keep), .m_last(m_last),
        .m_source(m_source), .m_valid(m_valid), .m_ready(m_ready),
        .packet_count(packet_count), .byte_count(byte_count)
    );

    // Reference queues contain only externally accepted beats.
    reg [63:0] q_data [0:3][0:Q_DEPTH-1];
    reg [7:0] q_keep [0:3][0:Q_DEPTH-1];
    reg q_last [0:3][0:Q_DEPTH-1];
    reg [1:0] q_dest [0:3][0:Q_DEPTH-1];
    integer q_head [0:3];
    integer q_tail [0:3];
    integer q_used [0:3];
    integer owner [0:3];
    reg [31:0] exp_packets [0:3];
    reg [31:0] exp_bytes [0:3];
    reg [3:0] sampled_in_fire = 0;
    reg [3:0] previous_stall = 0;
    reg [63:0] previous_data [0:3];
    reg [7:0] previous_keep [0:3];
    reg previous_last [0:3];
    reg [1:0] previous_source [0:3];
    integer stall_run [0:3];
    integer longest_stall [0:3];
    integer fair_age [0:3];
    integer fair_services [0:3][0:3];
    integer fair_next = -1;
    integer fair_destination = 0;
    integer phase_accepted [0:3];
    integer phase_emitted [0:3];
    integer accepted_total = 0;
    integer emitted_total = 0;
    integer discarded_total = 0;
    integer packet_total = 0;
    integer protocol_checks = 0;
    integer cycle_total = 0;
    integer phase_id = 0;
    integer mode = 0;
    integer phase_cycle = 0;
    integer throughput_cycles = 0;
    integer fair_rotations = 0;
    integer clears_with_transfer = 0;
    integer clears_with_stall = 0;
    integer reset_interruptions = 0;
    integer partial_keep_beats = 0;
    integer zero_keep_beats = 0;
    integer length_seen [1:48];
    integer input_packet_length [0:3];
    integer destination_seen [0:3];
    integer parallel_input_cycles = 0;
    reg [31:0] random_state = 32'h1;
    reg [31:0] phase_seed = 32'h1;

    task check_true;
        input condition;
        input [8*160-1:0] message;
        begin
            protocol_checks = protocol_checks + 1;
            if (condition !== 1'b1)
                $fatal(1, "cycle=%0d phase=%0d phase_cycle=%0d: %0s",
                       cycle_total, phase_id, phase_cycle, message);
        end
    endtask

    function [31:0] next_random;
        begin
            random_state = random_state ^ (random_state << 13);
            random_state = random_state ^ (random_state >> 17);
            random_state = random_state ^ (random_state << 5);
            next_random = random_state;
        end
    endfunction

    function integer popcount8;
        input [7:0] value;
        integer b;
        begin
            popcount8 = 0;
            for (b = 0; b < 8; b = b + 1)
                if (value[b]) popcount8 = popcount8 + 1;
        end
    endfunction

    function [63:0] keep_mask;
        input [7:0] value;
        integer b;
        begin
            keep_mask = 0;
            for (b = 0; b < 8; b = b + 1)
                keep_mask[b*8 +: 8] = {8{value[b]}};
        end
    endfunction

    function [63:0] payload;
        input integer source;
        input integer packet;
        input integer beat;
        begin
            payload = {phase_id[7:0], source[7:0], packet[15:0],
                       beat[15:0], 16'h9b6d} ^ {phase_seed, ~phase_seed};
        end
    endfunction

    function [7:0] generated_keep;
        input integer source;
        input integer packet;
        input integer beat;
        reg [31:0] random_word;
        begin
            random_word = next_random();
            case ((source + packet + beat) % 8)
                0: generated_keep = 8'hff;
                1: generated_keep = 8'h01;
                2: generated_keep = 8'h80;
                3: generated_keep = 8'h55;
                4: generated_keep = 8'h00;
                5: generated_keep = 8'h0f;
                default: generated_keep = random_word[7:0];
            endcase
        end
    endfunction

    // No clocked driver writes pins on this edge. Counter checks occur after NBA.
    always @(posedge clk) begin : scoreboard
        integer p;
        integer o;
        integer round;
        integer pick;
        integer source;
        integer input_fires;
        reg [3:0] pending;
        reg [3:0] output_fires;
        reg [3:0] fair_eligible;
        reg [63:0] mask;
        cycle_total = cycle_total + 1;
        check_true(cycle_total < 200000, "global cycle watchdog");
        if (rst) begin
            sampled_in_fire = 0;
            previous_stall = 0;
            fair_next = -1;
            for (p = 0; p < 4; p = p + 1) begin
                discarded_total = discarded_total + q_used[p];
                q_head[p] = 0;
                q_tail[p] = 0;
                q_used[p] = 0;
                owner[p] = -1;
                exp_packets[p] = 0;
                exp_bytes[p] = 0;
                fair_age[p] = 0;
                stall_run[p] = 0;
                input_packet_length[p] = 0;
            end
        end else begin
            check_true((^s_ready) !== 1'bx, "input ready contains X/Z");
            check_true((^m_valid) !== 1'bx, "output valid contains X/Z");
            sampled_in_fire = s_valid & s_ready;
            output_fires = m_valid & m_ready;
            pending = output_fires;
            input_fires = 0;
            // Arbitration eligibility is measured before this edge's new arrivals.
            for (p = 0; p < 4; p = p + 1)
                fair_eligible[p] = q_used[p] > 0 && q_dest[p][q_head[p]] == fair_destination;

            // Enqueue first: a legal combinational fall-through transfer is allowed.
            for (p = 0; p < 4; p = p + 1) begin
                if (sampled_in_fire[p]) begin
                    check_true(q_used[p] < Q_DEPTH, "testbench reference queue capacity");
                    q_data[p][q_tail[p]] = s_data[p*64 +: 64];
                    q_keep[p][q_tail[p]] = s_keep[p*8 +: 8];
                    q_last[p][q_tail[p]] = s_last[p];
                    q_dest[p][q_tail[p]] = s_dest[p*2 +: 2];
                    q_tail[p] = (q_tail[p] + 1) % Q_DEPTH;
                    q_used[p] = q_used[p] + 1;
                    phase_accepted[p] = phase_accepted[p] + 1;
                    accepted_total = accepted_total + 1;
                    input_fires = input_fires + 1;
                    input_packet_length[p] = input_packet_length[p] + 1;
                    if (s_last[p]) begin
                        if (input_packet_length[p] <= 48)
                            length_seen[input_packet_length[p]] = 1;
                        input_packet_length[p] = 0;
                    end
                end
            end
            if (input_fires >= 2) parallel_input_cycles = parallel_input_cycles + 1;

            for (o = 0; o < 4; o = o + 1) begin
                if (previous_stall[o]) begin
                    check_true(m_valid[o] === 1'b1, "valid withdrawn during output stall");
                    check_true(m_data[o*64 +: 64] === previous_data[o], "data changed during output stall");
                    check_true(m_keep[o*8 +: 8] === previous_keep[o], "keep changed during output stall");
                    check_true(m_last[o] === previous_last[o], "last changed during output stall");
                    check_true(m_source[o*2 +: 2] === previous_source[o], "source changed during output stall");
                end
                if (m_valid[o]) begin
                    check_true((^m_data[o*64 +: 64]) !== 1'bx, "valid output data contains X/Z");
                    check_true((^m_keep[o*8 +: 8]) !== 1'bx, "valid output keep contains X/Z");
                    check_true((^m_source[o*2 +: 2]) !== 1'bx, "valid output source contains X/Z");
                    check_true(m_last[o] !== 1'bx && m_last[o] !== 1'bz, "valid output last contains X/Z");
                    source = m_source[o*2 +: 2];
                    if (owner[o] >= 0)
                        check_true(source == owner[o], "packet source interleaving before last handshake");
                end
                previous_stall[o] = m_valid[o] && !m_ready[o];
                previous_data[o] = m_data[o*64 +: 64];
                previous_keep[o] = m_keep[o*8 +: 8];
                previous_last[o] = m_last[o];
                previous_source[o] = m_source[o*2 +: 2];
                if (previous_stall[o]) begin
                    stall_run[o] = stall_run[o] + 1;
                    if (stall_run[o] > longest_stall[o]) longest_stall[o] = stall_run[o];
                end else stall_run[o] = 0;
            end

            if (mode == MODE_FAIR) begin
                if (fair_eligible != 4'hf) fair_next = -1;
                if (output_fires[fair_destination]) begin
                    source = m_source[fair_destination*2 +: 2];
                    if (fair_next >= 0) begin
                        check_true(source == fair_next, "round-robin successor skipped a continuously eligible input");
                        fair_rotations = fair_rotations + 1;
                    end
                    if (fair_eligible == 4'hf) fair_next = (source + 1) % 4;
                    fair_services[fair_destination][source] = fair_services[fair_destination][source] + 1;
                end
                for (p = 0; p < 4; p = p + 1) begin
                    if (!fair_eligible[p] || (output_fires[fair_destination] && m_source[fair_destination*2 +: 2] == p))
                        fair_age[p] = 0;
                    else if (output_fires[fair_destination]) fair_age[p] = fair_age[p] + 1;
                    check_true(fair_age[p] < 16, "eligible input starved for 16 successful output handshakes");
                end
            end

            if (mode == MODE_THROUGHPUT && phase_cycle >= 48 && phase_cycle < 304) begin
                for (p = 0; p < 4; p = p + 1)
                    check_true(q_used[p] > 0, "throughput stimulus must have queued input data");
                check_true(output_fires === 4'hf, "saturated no-stall output throughput below one beat per cycle");
                throughput_cycles = throughput_cycles + 1;
            end

            // Resolve simultaneous outputs in each source's accepted queue order.
            // This does not impose output-index order on concurrent packet endings.
            for (p = 0; p < 4; p = p + 1) begin
                for (round = 0; round < 4; round = round + 1) begin
                    pick = -1;
                    for (o = 0; o < 4; o = o + 1)
                        if (pending[o] && m_source[o*2 +: 2] == p && q_used[p] > 0)
                            if (q_dest[p][q_head[p]] == o) pick = o;
                    if (pick >= 0) begin
                        o = pick;
                        mask = keep_mask(q_keep[p][q_head[p]]);
                        check_true((m_data[o*64 +: 64] & mask) === (q_data[p][q_head[p]] & mask), "output payload or per-input ordering mismatch");
                        check_true(m_keep[o*8 +: 8] === q_keep[p][q_head[p]], "output keep mismatch");
                        check_true(m_last[o] === q_last[p][q_head[p]], "output last mismatch");
                        check_true(owner[o] < 0 || owner[o] == p, "output packet ownership mismatch");
                        if (m_last[o]) owner[o] = -1;
                        else owner[o] = p;
                        if (!clear_stats) begin
                            exp_bytes[o] = exp_bytes[o] + popcount8(m_keep[o*8 +: 8]);
                            if (m_last[o]) exp_packets[o] = exp_packets[o] + 1;
                        end
                        if (m_last[o]) packet_total = packet_total + 1;
                        if (m_keep[o*8 +: 8] != 8'hff) partial_keep_beats = partial_keep_beats + 1;
                        if (m_keep[o*8 +: 8] == 0) zero_keep_beats = zero_keep_beats + 1;
                        destination_seen[o] = destination_seen[o] + 1;
                        phase_emitted[o] = phase_emitted[o] + 1;
                        emitted_total = emitted_total + 1;
                        q_head[p] = (q_head[p] + 1) % Q_DEPTH;
                        q_used[p] = q_used[p] - 1;
                        pending[o] = 0;
                    end
                end
            end
            check_true(pending == 0, "unmatched output: phantom beat, false source, misroute, duplicate, or input reorder");
            if (mode == MODE_FAIR)
                for (p = 0; p < 4; p = p + 1)
                    if (q_used[p] == 0) begin
                        fair_next = -1;
                        fair_age[p] = 0;
                    end
            if (clear_stats) begin
                if (output_fires != 0) clears_with_transfer = clears_with_transfer + 1;
                if ((m_valid & ~m_ready) != 0) clears_with_stall = clears_with_stall + 1;
                for (o = 0; o < 4; o = o + 1) begin
                    exp_packets[o] = 0;
                    exp_bytes[o] = 0;
                end
            end
        end
        #1;
        for (o = 0; o < 4; o = o + 1) begin
            check_true(packet_count[o*32 +: 32] === exp_packets[o], "packet counter mismatch, including reset/clear priority");
            check_true(byte_count[o*32 +: 32] === exp_bytes[o], "byte counter mismatch, including keep population and clear priority");
        end
        if (rst) check_true(m_valid === 4'b0000, "reset did not discard pending output valid");
    end

    task poison_invalid;
        input integer p;
        reg [31:0] a;
        reg [31:0] b;
        begin
            a = next_random();
            b = next_random();
            s_data[p*64 +: 64] = {a,b};
            s_keep[p*8 +: 8] = a[7:0];
            s_last[p] = a[8];
            s_dest[p*2 +: 2] = a[10:9];
        end
    endtask

    task idle_guard;
        input integer cycles;
        integer n;
        integer p;
        begin
            for (n = 0; n < cycles; n = n + 1) begin
                @(negedge clk);
                mode = 0;
                s_valid = 0;
                m_ready = 4'hf;
                clear_stats = 0;
                for (p = 0; p < 4; p = p + 1) poison_invalid(p);
            end
            @(negedge clk);
            for (p = 0; p < 4; p = p + 1) begin
                check_true(q_used[p] == 0, "drain left expected beats in an input queue");
                check_true(owner[p] == -1, "drain left an unterminated output packet");
            end
            check_true(m_valid === 4'b0000, "idle guard observed pending output without input traffic");
        end
    endtask

    task run_phase;
        input integer selected_mode;
        input integer packets_per_input;
        input [31:0] seed;
        integer p;
        integer c;
        integer sent [0:3];
        integer position [0:3];
        integer length [0:3];
        integer dest [0:3];
        integer active [0:3];
        integer drained;
        reg [31:0] random_word;
        begin
            @(negedge clk);
            phase_id = phase_id + 1;
            mode = selected_mode;
            phase_seed = seed;
            random_state = seed;
            fair_destination = seed[1:0];
            phase_cycle = 0;
            s_valid = 0;
            m_ready = 0;
            clear_stats = 0;
            fair_next = -1;
            for (p = 0; p < 4; p = p + 1) begin
                check_true(q_used[p] == 0, "phase started before previous input queues drained");
                sent[p] = 0;
                position[p] = 0;
                length[p] = 0;
                dest[p] = 0;
                active[p] = 0;
                phase_accepted[p] = 0;
                phase_emitted[p] = 0;
                fair_age[p] = 0;
            end
            c = 0;
            drained = 0;
            while (!drained && c < 40000) begin
                @(negedge clk);
                phase_cycle = c;
                clear_stats = 0;
                if (selected_mode == MODE_THROUGHPUT && (c == 80 || c == 81)) clear_stats = 1;
                if (selected_mode == MODE_CAPACITY && (c == 40 || c == 41)) clear_stats = 1;
                if (selected_mode == MODE_RANDOM && c % 37 == 9) clear_stats = 1;
                for (p = 0; p < 4; p = p + 1) begin
                    random_word = next_random();
                    m_ready[p] = 1;
                    if (selected_mode == MODE_RANDOM) begin
                        m_ready[p] = random_word % 100 < 67;
                        if (c >= 40 + p*11 && c < 96 + p*11) m_ready[p] = 0;
                    end
                    if (selected_mode == MODE_CAPACITY && c < 48) m_ready[p] = 0;
                    if (selected_mode == MODE_THROUGHPUT && c < 32) m_ready[p] = 0;
                    if (selected_mode == MODE_FAIR && c < 32) m_ready[p] = 0;
                    if (selected_mode == MODE_CONGEST && p == 0 && c < 128) m_ready[p] = 0;

                    if (s_valid[p] && sampled_in_fire[p]) begin
                        if (position[p] == length[p] - 1) begin
                            sent[p] = sent[p] + 1;
                            active[p] = 0;
                        end else position[p] = position[p] + 1;
                    end
                    // A stalled valid beat is preserved exactly.
                    if (!(s_valid[p] && !sampled_in_fire[p])) begin
                        s_valid[p] = 0;
                        if (sent[p] < packets_per_input) begin
                            if (!active[p]) begin
                                active[p] = 1;
                                position[p] = 0;
                                random_word = next_random();
                                if (selected_mode == MODE_RANDOM) begin
                                    // The first 48 packets cover every length for every source.
                                    if (sent[p] < 48) length[p] = 1 + (sent[p] + p*7) % 48;
                                    else length[p] = 1 + random_word % 48;
                                    random_word = next_random();
                                    dest[p] = random_word % 4;
                                end else begin
                                    dest[p] = p;
                                    length[p] = 48;
                                    if (selected_mode == MODE_CAPACITY) length[p] = 16;
                                    if (selected_mode == MODE_FAIR) begin
                                        length[p] = 1;
                                        dest[p] = fair_destination;
                                    end
                                end
                            end
                            random_word = next_random();
                            if (selected_mode != MODE_RANDOM || random_word % 100 >= 19) begin
                                s_valid[p] = 1;
                                s_data[p*64 +: 64] = payload(p, sent[p], position[p]);
                                if (selected_mode == MODE_THROUGHPUT) s_keep[p*8 +: 8] = 8'hff;
                                else s_keep[p*8 +: 8] = generated_keep(p, sent[p], position[p]);
                                s_last[p] = position[p] == length[p] - 1;
                                s_dest[p*2 +: 2] = dest[p];
                            end
                        end
                        if (!s_valid[p]) poison_invalid(p);
                    end
                end
                if (selected_mode == MODE_CAPACITY && c == 32)
                    for (p = 0; p < 4; p = p + 1)
                        check_true(phase_accepted[p] >= 16, "blocked outputs did not permit 16 outstanding input beats");
                if (selected_mode == MODE_CONGEST && c == 127)
                    for (p = 1; p < 4; p = p + 1)
                        check_true(phase_emitted[p] >= 32, "output-zero congestion blocked an independent output stream");
                drained = 1;
                for (p = 0; p < 4; p = p + 1)
                    if (sent[p] != packets_per_input || q_used[p] != 0 || s_valid[p]) drained = 0;
                c = c + 1;
            end
            check_true(drained, "phase watchdog: input deadlock, missing output, or incomplete drain");
            $display("FROM_ZERO_PHASE project=packet-switch phase=%0d mode=%0d seed=%08x cycles=%0d packets=%0d beats=%0d",
                     phase_id, selected_mode, seed, c, packet_total, emitted_total);
            idle_guard(12);
        end
    endtask

    task reset_midpacket;
        integer p;
        integer c;
        integer sent [0:3];
        integer ready_to_reset;
        begin
            @(negedge clk);
            phase_id = phase_id + 1;
            mode = MODE_RESET;
            phase_seed = 32'hc0ffee71;
            random_state = phase_seed;
            phase_cycle = 0;
            s_valid = 0;
            m_ready = 4'hf;
            clear_stats = 0;
            for (p = 0; p < 4; p = p + 1) begin
                sent[p] = 0;
                phase_accepted[p] = 0;
                phase_emitted[p] = 0;
            end
            c = 0;
            ready_to_reset = 0;
            while (!ready_to_reset && c < 256) begin
                @(negedge clk);
                phase_cycle = c;
                for (p = 0; p < 4; p = p + 1) begin
                    if (s_valid[p] && sampled_in_fire[p]) sent[p] = sent[p] + 1;
                    if (!(s_valid[p] && !sampled_in_fire[p])) begin
                        s_valid[p] = sent[p] < 48;
                        if (s_valid[p]) begin
                            s_data[p*64 +: 64] = payload(p, 0, sent[p]);
                            s_keep[p*8 +: 8] = generated_keep(p, 0, sent[p]);
                            s_last[p] = sent[p] == 47;
                            s_dest[p*2 +: 2] = p;
                        end else poison_invalid(p);
                    end
                    m_ready[p] = phase_emitted[p] == 0;
                end
                ready_to_reset = c >= 48;
                for (p = 0; p < 4; p = p + 1)
                    if (owner[p] != p || q_used[p] == 0 || !previous_stall[p]) ready_to_reset = 0;
                c = c + 1;
            end
            check_true(ready_to_reset, "mid-packet reset trial failed to establish four active stalled packets");
            reset_interruptions = reset_interruptions + 1;
            rst = 1;
            clear_stats = 1;
            s_valid = 0;
            m_ready = 4'hf;
            repeat (3) @(negedge clk);
            rst = 0;
            clear_stats = 0;
            idle_guard(16);
        end
    endtask

    initial begin : stimulus
        integer p;
        integer n;
        for (p = 0; p < 4; p = p + 1) begin
            q_head[p] = 0;
            q_tail[p] = 0;
            q_used[p] = 0;
            owner[p] = -1;
            exp_packets[p] = 0;
            exp_bytes[p] = 0;
            fair_age[p] = 0;
            for (n = 0; n < 4; n = n + 1) fair_services[p][n] = 0;
            phase_accepted[p] = 0;
            phase_emitted[p] = 0;
            stall_run[p] = 0;
            longest_stall[p] = 0;
            input_packet_length[p] = 0;
            destination_seen[p] = 0;
        end
        for (n = 1; n <= 48; n = n + 1) length_seen[n] = 0;
        repeat (4) @(negedge clk);
        rst = 0;
        idle_guard(8);
        run_phase(MODE_CAPACITY, 1, 32'h9e3779b9);
        run_phase(MODE_RANDOM, 64, 32'h13adbeef);
        run_phase(MODE_CONGEST, 8, 32'hb5297a4d);
        run_phase(MODE_FAIR, 64, 32'h68e31da4);
        run_phase(MODE_FAIR, 64, 32'h68e31da5);
        run_phase(MODE_FAIR, 64, 32'h68e31da6);
        run_phase(MODE_FAIR, 64, 32'h68e31da7);
        run_phase(MODE_THROUGHPUT, 8, 32'h1b56c4e9);
        reset_midpacket();
        run_phase(MODE_RANDOM, 64, 32'h7654321d);
        run_phase(MODE_RANDOM, 64, 32'hd00d4a31);
        idle_guard(32);

        check_true(packet_total >= 500, "insufficient complete packet coverage");
        check_true(accepted_total == emitted_total + discarded_total, "accepted/emitted/reset-discard beat accounting mismatch");
        check_true(throughput_cycles == 256, "throughput measurement window was not fully exercised");
        check_true(fair_rotations >= 512, "insufficient full-eligibility round-robin rotations");
        check_true(clears_with_transfer >= 2, "counter clear was not checked during live output transfers");
        check_true(clears_with_stall >= 1, "counter clear was not checked during an output stall");
        check_true(reset_interruptions == 1 && discarded_total >= 4, "mid-packet reset discard was not exercised");
        check_true(partial_keep_beats >= 100 && zero_keep_beats >= 20, "partial/zero keep coverage insufficient");
        check_true(parallel_input_cycles >= 100, "concurrent input traffic coverage insufficient");
        for (p = 0; p < 4; p = p + 1) begin
            for (n = 0; n < 4; n = n + 1)
                check_true(fair_services[p][n] == 64, "fairness phase did not serve every offered one-beat packet on every output");
            check_true(destination_seen[p] >= 32, "destination routing coverage insufficient");
            check_true(longest_stall[p] >= 16, "long output stall coverage insufficient");
        end
        for (n = 1; n <= 48; n = n + 1)
            check_true(length_seen[n] == 1, "packet-length coverage hole in 1..48 beats");
        $display("FROM_ZERO_COVERAGE project=packet-switch accepted=%0d discarded=%0d partial_keep=%0d zero_keep=%0d fairness_rotations=%0d throughput_cycles=%0d clear_transfer=%0d clear_stall=%0d resets=%0d",
                 accepted_total, discarded_total, partial_keep_beats, zero_keep_beats,
                 fair_rotations, throughput_cycles, clears_with_transfer, clears_with_stall, reset_interruptions);
        $display("FROM_ZERO_PASS project=packet-switch packets=%0d beats=%0d protocol_checks=%0d",
                 packet_total, emitted_total, protocol_checks);
        $finish;
    end

    initial begin : wall_watchdog
        #2000000;
        $fatal(1, "global simulation-time watchdog");
    end
endmodule
