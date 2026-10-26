`timescale 1ns/1ps
module tb_z_dma;
    localparam integer COUNT = 128;
    localparam integer MEM_BYTES = 2097152;
    localparam integer IDLE = 0, READ = 1, NEED_AW = 2, WRITE = 3, RESPONSE = 4, DONE = 5;
    reg clk = 0;
    always #5 clk = ~clk;
    reg rst = 1;
    reg desc_valid = 0;
    wire desc_ready;
    reg [31:0] desc_src = 0, desc_dst = 0;
    reg [15:0] desc_len = 0;
    reg [7:0] desc_tag = 0;
    wire status_valid;
    reg status_ready = 0;
    wire [7:0] status_tag;
    wire status_error;
    wire [31:0] m_axi_araddr, m_axi_awaddr;
    wire [7:0] m_axi_arlen, m_axi_awlen;
    wire [2:0] m_axi_arsize, m_axi_awsize;
    wire [1:0] m_axi_arburst, m_axi_awburst;
    wire m_axi_arvalid, m_axi_awvalid;
    reg m_axi_arready = 0, m_axi_awready = 0;
    reg [63:0] m_axi_rdata = 0;
    reg [1:0] m_axi_rresp = 0;
    reg m_axi_rlast = 0, m_axi_rvalid = 0;
    wire m_axi_rready;
    wire [63:0] m_axi_wdata;
    wire [7:0] m_axi_wstrb;
    wire m_axi_wlast, m_axi_wvalid;
    reg m_axi_wready = 0;
    reg [1:0] m_axi_bresp = 0;
    reg m_axi_bvalid = 0;
    wire m_axi_bready;
    z_dma dut (.*);

    // The reference has no implementation datapath: it validates each externally
    // visible transfer against the immutable descriptor and initial source bytes.
    reg [7:0] memory [0:MEM_BYTES-1];
    reg [7:0] expected [0:MEM_BYTES-1];
    integer src [0:COUNT-1], dst [0:COUNT-1], length [0:COUNT-1];
    integer error_kind [0:COUNT-1], error_burst [0:COUNT-1], error_position [0:COUNT-1];
    reg [7:0] tags [0:COUNT-1];
    integer lengths [0:31];
    integer offsets [0:7];
    integer head, tail, state, offset_bytes, burst_no, beats, burst_bytes;
    integer r_index, w_index, ar_address, aw_address, r_error_beat;
    integer cycles, epoch_cycles, epoch, requested, main_bytes, protocol_checks;
    integer completed, read_errors, write_errors, reset_count, queue_highwater;
    integer ar_stalls, aw_stalls, w_stalls, r_gaps, b_gaps, status_stalls, desc_stalls;
    integer read_bursts, write_bursts, crossed_descriptors;
    integer i, j, k, limit_bytes, lane_address;
    reg read_bad, write_bad, result_error, abort_has_write;
    reg hold_ar, hold_aw, hold_w, hold_status, hold_r, hold_b;
    reg [44:0] saved_ar, saved_aw;
    reg [72:0] saved_w;
    reg [8:0] saved_status;
    reg [7:0] want_strobe;
    reg [31:0] rng = 32'h61a7d9e3;
    reg [31:0] random_word;

    function automatic [7:0] initial_byte(input integer address);
        reg [31:0] mixed;
        begin
            // Avalanche all address bits so adjacent/repeated/reordered 128-byte
            // chunks cannot pass through a simple short-period byte pattern.
            mixed = address + 32'h9e3779b9;
            mixed = (mixed ^ (mixed >> 16)) * 32'h7feb352d;
            mixed = (mixed ^ (mixed >> 15)) * 32'h846ca68b;
            mixed = mixed ^ (mixed >> 16);
            initial_byte = mixed[7:0];
        end
    endfunction

    function automatic [31:0] next_random;
        reg [31:0] value;
        begin
            value = rng;
            value = value ^ (value << 13);
            value = value ^ (value >> 17);
            value = value ^ (value << 5);
            rng = value;
            next_random = value;
        end
    endfunction

    task clear_model;
        begin
            head = 0; tail = 0; state = IDLE; offset_bytes = 0; burst_no = 0;
            beats = 0; burst_bytes = 0; r_index = 0; w_index = 0;
            read_bad = 0; write_bad = 0; result_error = 0; abort_has_write = 0;
            hold_ar = 0; hold_aw = 0; hold_w = 0; hold_status = 0; hold_r = 0; hold_b = 0;
            epoch_cycles = 0;
        end
    endtask

    task check_memory;
        integer address;
        begin
            for (address = 0; address < MEM_BYTES; address = address + 1)
                if (memory[address] !== expected[address])
                    $fatal(1, "memory mismatch epoch=%0d address=%h actual=%h expected=%h", epoch, address, memory[address], expected[address]);
        end
    endtask

    task reset_epoch;
        begin
            @(negedge clk);
            rst = 1; desc_valid = 0; status_ready = 0;
            m_axi_arready = 0; m_axi_awready = 0; m_axi_wready = 0;
            m_axi_rvalid = 0; m_axi_bvalid = 0;
            clear_model;
            repeat (4) begin
                @(posedge clk);
                #1;
                if ({m_axi_arvalid, m_axi_awvalid, m_axi_wvalid, status_valid} !== 4'b0000)
                    $fatal(1, "reset did not clear outgoing VALID signals");
            end
            @(negedge clk);
            rst = 0;
        end
    endtask

    task drive_cycle;
        begin
            // Called only on a falling edge. All sampled handshakes are processed
            // at the following rising edge, before DUT nonblocking assignments.
            desc_valid = (tail < requested);
            if (tail < requested) begin
                desc_src = src[tail]; desc_dst = dst[tail];
                desc_len = length[tail]; desc_tag = tags[tail];
            end
            random_word = next_random();
            status_ready = random_word[0] && ((epoch_cycles % 37) >= 9);
            m_axi_arready = (state == IDLE) && (random_word[2:1] != 0);
            m_axi_awready = (state == NEED_AW) && (random_word[4:3] != 0);
            m_axi_wready = (state == WRITE) && (random_word[6:5] != 0);
            if (epoch == 1 && abort_has_write) m_axi_wready = 0;
            if (!hold_r) begin
                m_axi_rvalid = (state == READ) && (random_word[8:7] != 0) && (epoch != 0);
                if (m_axi_rvalid) begin
                    for (j = 0; j < 8; j = j + 1)
                        m_axi_rdata[j*8 +: 8] = memory[ar_address + r_index*8 + j];
                    m_axi_rlast = (r_index == beats-1);
                    m_axi_rresp = (read_bad && r_index == r_error_beat) ? ((head % 2) ? 2'b11 : 2'b10) : 2'b00;
                end
            end
            if (!hold_b) begin
                m_axi_bvalid = (state == RESPONSE) && (random_word[10:9] != 0) && (epoch != 1);
                m_axi_bresp = write_bad ? ((head % 2) ? 2'b11 : 2'b10) : 2'b00;
            end
        end
    endtask

    task sample_cycle;
        begin
            cycles = cycles + 1; epoch_cycles = epoch_cycles + 1;
            protocol_checks = protocol_checks + 1;
            if (cycles > 1000000) $fatal(1, "cycle watchdog epoch=%0d head=%0d tail=%0d state=%0d", epoch, head, tail, state);
            if ((^{desc_ready, status_valid, m_axi_arvalid, m_axi_awvalid, m_axi_wvalid, m_axi_rready, m_axi_bready}) === 1'bx)
                $fatal(1, "unknown control output epoch=%0d cycle=%0d", epoch, cycles);
            if (hold_ar && (m_axi_arvalid !== 1'b1 || {m_axi_araddr,m_axi_arlen,m_axi_arsize,m_axi_arburst} !== saved_ar))
                $fatal(1, "AR payload/VALID changed under backpressure");
            if (hold_aw && (m_axi_awvalid !== 1'b1 || {m_axi_awaddr,m_axi_awlen,m_axi_awsize,m_axi_awburst} !== saved_aw))
                $fatal(1, "AW payload/VALID changed under backpressure");
            if (hold_w && (m_axi_wvalid !== 1'b1 || {m_axi_wdata,m_axi_wstrb,m_axi_wlast} !== saved_w))
                $fatal(1, "W payload/VALID changed under backpressure");
            if (hold_status && (status_valid !== 1'b1 || {status_tag,status_error} !== saved_status))
                $fatal(1, "status payload/VALID changed under backpressure");
            if (m_axi_arvalid && (^{m_axi_araddr,m_axi_arlen,m_axi_arsize,m_axi_arburst}) === 1'bx)
                $fatal(1, "unknown AR payload");
            if (m_axi_awvalid && (^{m_axi_awaddr,m_axi_awlen,m_axi_awsize,m_axi_awburst}) === 1'bx)
                $fatal(1, "unknown AW payload");
            if (m_axi_wvalid && (^{m_axi_wdata,m_axi_wstrb,m_axi_wlast}) === 1'bx)
                $fatal(1, "unknown W payload");

            if (desc_valid && desc_ready) begin
                if (tail >= requested) $fatal(1, "unexpected descriptor handshake");
                tail = tail + 1;
                if (tail-head > queue_highwater) queue_highwater = tail-head;
                protocol_checks = protocol_checks + 1;
            end
            if (desc_valid && !desc_ready) desc_stalls = desc_stalls + 1;

            if (m_axi_arvalid && m_axi_arready) begin
                if (state != IDLE || head >= tail) $fatal(1, "AR without available descriptor or multiple outstanding transactions");
                if (m_axi_araddr !== (src[head] + offset_bytes)) $fatal(1, "incorrect AR address descriptor=%0d offset=%0d got=%h", head, offset_bytes, m_axi_araddr);
                if (m_axi_arsize !== 3 || m_axi_arburst !== 1 || m_axi_arlen > 15)
                    $fatal(1, "invalid AR SIZE/BURST/LEN");
                beats = m_axi_arlen + 1;
                if (beats > ((length[head]-offset_bytes+7)/8)) $fatal(1, "AR reads beyond final rounded beat");
                if (((src[head]+offset_bytes) % 4096) + beats*8 > 4096 ||
                    ((dst[head]+offset_bytes) % 4096) + beats*8 > 4096)
                    $fatal(1, "burst crosses source or destination 4 KiB boundary");
                ar_address = m_axi_araddr;
                burst_bytes = beats*8;
                if (burst_bytes > length[head]-offset_bytes) burst_bytes = length[head]-offset_bytes;
                read_bad = (epoch == 2 && error_kind[head] == 1 && burst_no == error_burst[head]);
                write_bad = (epoch == 2 && error_kind[head] == 2 && burst_no == error_burst[head]);
                if (error_position[head] == 0) r_error_beat = 0;
                else if (error_position[head] == 1) r_error_beat = beats/2;
                else r_error_beat = beats-1;
                r_index = 0; state = READ;
                if (epoch == 2) read_bursts = read_bursts + 1;
                protocol_checks = protocol_checks + 1;
            end
            if (m_axi_rvalid && m_axi_rready) begin
                if (state != READ) $fatal(1, "R handshake outside read burst");
                r_index = r_index + 1;
                protocol_checks = protocol_checks + 1;
                if (r_index == beats) begin
                    if (read_bad) begin state = DONE; result_error = 1; end
                    else state = NEED_AW;
                end
            end
            if (m_axi_awvalid && m_axi_awready) begin
                if (state != NEED_AW || read_bad) $fatal(1, "AW before complete successful R burst");
                if (m_axi_awaddr !== (dst[head]+offset_bytes) || m_axi_awlen !== (beats-1) || m_axi_awsize !== 3 || m_axi_awburst !== 1)
                    $fatal(1, "AW does not match validated read chunk descriptor=%0d", head);
                aw_address = m_axi_awaddr;
                w_index = 0; state = WRITE;
                if (epoch == 2) write_bursts = write_bursts + 1;
                protocol_checks = protocol_checks + 1;
            end
            if (m_axi_wvalid && m_axi_wready) begin
                if (state != WRITE) $fatal(1, "W handshake outside accepted AW burst");
                limit_bytes = length[head] - offset_bytes - w_index*8;
                if (limit_bytes > 8) limit_bytes = 8;
                if (limit_bytes <= 0) $fatal(1, "excess W beat");
                want_strobe = (1 << limit_bytes)-1;
                if (m_axi_wstrb !== want_strobe || m_axi_wlast !== (w_index == beats-1))
                    $fatal(1, "incorrect WSTRB/WLAST descriptor=%0d beat=%0d strobe=%h expected=%h", head, w_index, m_axi_wstrb, want_strobe);
                for (k = 0; k < 8; k = k + 1) begin
                    if (m_axi_wstrb[k]) begin
                        lane_address = aw_address + w_index*8 + k;
                        if (lane_address < dst[head] || lane_address >= dst[head]+length[head] || lane_address >= MEM_BYTES)
                            $fatal(1, "write outside descriptor range");
                        if (m_axi_wdata[k*8 +: 8] !== initial_byte(src[head]+offset_bytes+w_index*8+k))
                            $fatal(1, "incorrect write byte descriptor=%0d address=%h", head, lane_address);
                        memory[lane_address] = m_axi_wdata[k*8 +: 8];
                        expected[lane_address] = initial_byte(src[head]+offset_bytes+w_index*8+k);
                        if (epoch == 2) main_bytes = main_bytes + 1;
                        protocol_checks = protocol_checks + 1;
                    end
                end
                abort_has_write = 1;
                w_index = w_index + 1;
                if (w_index == beats) state = RESPONSE;
            end
            if (m_axi_bvalid && m_axi_bready) begin
                if (state != RESPONSE) $fatal(1, "B consumed before all W beats");
                offset_bytes = offset_bytes + burst_bytes;
                if (write_bad) begin state = DONE; result_error = 1; end
                else if (offset_bytes == length[head]) begin state = DONE; result_error = 0; end
                else begin state = IDLE; burst_no = burst_no + 1; end
                protocol_checks = protocol_checks + 1;
            end
            // Check status on presentation as well as handshake: an early valid
            // completion must not be hidden by completion backpressure.
            if (status_valid) begin
                if (state != DONE || head >= tail) $fatal(1, "early/duplicate/spurious status epoch=%0d head=%0d state=%0d", epoch, head, state);
                if (status_tag !== tags[head] || status_error !== result_error)
                    $fatal(1, "incorrect status tag/error descriptor=%0d tag=%h error=%b", head, status_tag, status_error);
            end
            if (status_valid && status_ready) begin
                if (epoch != 2) $fatal(1, "abort epoch unexpectedly completed descriptor");
                if (result_error !== (error_kind[head] != 0)) $fatal(1, "planned response error was not exercised");
                if (!result_error) begin
                    if (offset_bytes != length[head]) $fatal(1, "successful status before exact length copied");
                    for (k = 0; k < length[head]; k = k + 1)
                        if (memory[dst[head]+k] !== initial_byte(src[head]+k)) $fatal(1, "completed descriptor byte mismatch");
                end
                if (error_kind[head] == 1) read_errors = read_errors + 1;
                if (error_kind[head] == 2) write_errors = write_errors + 1;
                if (((src[head] % 4096)+length[head] > 4096) || ((dst[head] % 4096)+length[head] > 4096)) crossed_descriptors = crossed_descriptors + 1;
                completed = completed + 1; head = head + 1;
                state = IDLE; offset_bytes = 0; burst_no = 0; result_error = 0;
                protocol_checks = protocol_checks + 1;
            end

            hold_ar = m_axi_arvalid && !m_axi_arready;
            hold_aw = m_axi_awvalid && !m_axi_awready;
            hold_w = m_axi_wvalid && !m_axi_wready;
            hold_status = status_valid && !status_ready;
            hold_r = m_axi_rvalid && !m_axi_rready;
            hold_b = m_axi_bvalid && !m_axi_bready;
            saved_ar = {m_axi_araddr,m_axi_arlen,m_axi_arsize,m_axi_arburst};
            saved_aw = {m_axi_awaddr,m_axi_awlen,m_axi_awsize,m_axi_awburst};
            saved_w = {m_axi_wdata,m_axi_wstrb,m_axi_wlast};
            saved_status = {status_tag,status_error};
            if (epoch == 2) begin
                if (hold_ar) ar_stalls = ar_stalls + 1;
                if (hold_aw) aw_stalls = aw_stalls + 1;
                if (hold_w) w_stalls = w_stalls + 1;
                if (hold_status) status_stalls = status_stalls + 1;
                if (state == READ && !m_axi_rvalid) r_gaps = r_gaps + 1;
                if (state == RESPONSE && !m_axi_bvalid) b_gaps = b_gaps + 1;
            end
        end
    endtask

    initial begin
        // An independent simulated-time watchdog also catches dead clocks/loops.
        #20000000;
        $fatal(1, "simulation-time watchdog");
    end

    initial begin
        lengths[0]=1; lengths[1]=2; lengths[2]=7; lengths[3]=8;
        lengths[4]=9; lengths[5]=15; lengths[6]=16; lengths[7]=17;
        lengths[8]=31; lengths[9]=63; lengths[10]=64; lengths[11]=65;
        lengths[12]=127; lengths[13]=128; lengths[14]=129; lengths[15]=255;
        lengths[16]=256; lengths[17]=257; lengths[18]=511; lengths[19]=512;
        lengths[20]=513; lengths[21]=1023; lengths[22]=1024; lengths[23]=1025;
        lengths[24]=2047; lengths[25]=2048; lengths[26]=2049; lengths[27]=3071;
        lengths[28]=3072; lengths[29]=4089; lengths[30]=4095; lengths[31]=4096;
        offsets[0]=0; offsets[1]=8; offsets[2]=120; offsets[3]=2040;
        offsets[4]=3968; offsets[5]=4032; offsets[6]=4080; offsets[7]=4088;
        for (i = 0; i < COUNT; i = i + 1) begin
            src[i] = 4096 + (i%8)*8192 + offsets[i%8];
            dst[i] = 131072 + i*8192 + offsets[(i*3+5)%8];
            length[i] = lengths[(i*11)%32];
            tags[i] = (i*73+19) & 255;
            error_kind[i] = 0; error_burst[i] = 0; error_position[i] = 0;
            case (i%16)
                4: begin error_kind[i]=1; error_position[i]=0; end
                5: begin error_kind[i]=1; error_burst[i]=1; error_position[i]=1; length[i]=777; end
                6: begin error_kind[i]=1; error_position[i]=2; end
                7: begin error_kind[i]=2; end
                8: begin error_kind[i]=2; error_burst[i]=1; length[i]=4096; end
            endcase
        end
        // A long first transfer keeps the abort epochs in flight.
        length[0] = 4096;
        for (i = 0; i < MEM_BYTES; i = i + 1) begin
            memory[i] = initial_byte(i); expected[i] = initial_byte(i);
        end
        cycles=0; main_bytes=0; protocol_checks=0; completed=0;
        read_errors=0; write_errors=0; reset_count=0; queue_highwater=0;
        ar_stalls=0; aw_stalls=0; w_stalls=0; r_gaps=0; b_gaps=0; status_stalls=0; desc_stalls=0;
        read_bursts=0; write_bursts=0; crossed_descriptors=0;
        for (epoch = 0; epoch < 3; epoch = epoch + 1) begin
            requested = (epoch == 2) ? COUNT : 5;
            reset_epoch;
            begin : epoch_loop
                while (1) begin
                    @(negedge clk); drive_cycle;
                    @(posedge clk); sample_cycle;
                    if (epoch < 2 && epoch_cycles > 2000)
                        $fatal(1, "queue/reset setup timeout: need active plus four pending epoch=%0d accepted=%0d", epoch, tail);
                    if (epoch == 0 && tail == 5 && state == READ) disable epoch_loop;
                    if (epoch == 1 && tail == 5 && abort_has_write) disable epoch_loop;
                    if (epoch == 2 && completed == COUNT) disable epoch_loop;
                end
            end
            check_memory;
            if (epoch < 2) reset_count = reset_count + 1;
        end
        // Keep observing after the last status to catch duplicate status/traffic.
        epoch = 2; requested = COUNT;
        repeat (50) begin
            @(negedge clk); drive_cycle;
            @(posedge clk); sample_cycle;
            if (m_axi_arvalid || m_axi_awvalid || m_axi_wvalid || status_valid)
                $fatal(1, "spurious output after final completion");
        end
        check_memory;
        if (completed != COUNT || tail != COUNT || head != COUNT || read_errors != 24 || write_errors != 16 || reset_count != 2 || queue_highwater < 5)
            $fatal(1, "required descriptor/error/reset/FIFO coverage missing");
        if (ar_stalls == 0 || aw_stalls == 0 || w_stalls == 0 || r_gaps == 0 || b_gaps == 0 || status_stalls == 0 || crossed_descriptors == 0)
            $fatal(1, "required independent backpressure/boundary coverage missing");
        $display("DMA_COVERAGE read_errors=%0d write_errors=%0d resets=%0d queue_highwater=%0d read_bursts=%0d write_bursts=%0d boundary_descriptors=%0d", read_errors, write_errors, reset_count, queue_highwater, read_bursts, write_bursts, crossed_descriptors);
        $display("DMA_STALLS ar=%0d aw=%0d w=%0d r_gaps=%0d b_gaps=%0d status=%0d descriptor=%0d", ar_stalls, aw_stalls, w_stalls, r_gaps, b_gaps, status_stalls, desc_stalls);
        $display("FROM_ZERO_PASS project=dma descriptors=%0d bytes=%0d protocol_checks=%0d", completed, main_bytes, protocol_checks);
        $finish;
    end
endmodule
