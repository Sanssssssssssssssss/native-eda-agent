`timescale 1ns/1ps
// Frozen acceptance testbench: drive on falling edges, sample on rising edges.
module tb_spectrum;
    localparam N = 1024;
    localparam FRAMES = 16;
    reg clk = 0;
    always #5 clk = ~clk;
    reg rst_n = 0;
    reg [15:0] s_data = 0;
    reg s_valid = 0, s_last = 0;
    wire s_ready;
    wire [15:0] m_data;
    wire m_valid, m_last;
    reg m_ready = 0;
    wire [31:0] fft_data;
    wire event_bad_last;
    spectrum_core dut(.*);
    reg [15:0] input_mem [0:N*FRAMES-1];
    integer fd, cycle = 0, output_count = 0, output_stalls = 0, input_stalls = 0;
    integer total_output_stalls = 0, total_input_stalls = 0;
    integer expected_frame = 0, frame_bin = 0;
    reg [31:0] random_state = 32'h29387465;
    reg was_stalled = 0;
    reg [48:0] held_output;
    reg allow_output = 1;
    integer reset_count = 0;

    always @(negedge clk) begin
        random_state = {random_state[30:0], random_state[31]^random_state[21]^random_state[1]^random_state[0]};
        // Several long stalls guarantee backpressure propagates through the whole FFT.
        m_ready = rst_n && (random_state[2:0] != 0) && !((cycle % 12000) >= 4000 && (cycle % 12000) < 6500);
    end
    always @(posedge clk) begin
        cycle = cycle + 1;
        if (!rst_n) was_stalled = 0;
        else begin
            if (event_bad_last) $fatal(1, "FFT reported incorrect input framing");
            if (was_stalled && ({m_valid, m_last, fft_data, m_data} !== {1'b1, held_output}))
                $fatal(1, "AXI output changed while stalled");
            was_stalled = m_valid && !m_ready;
            held_output = {m_last, fft_data, m_data};
            if (m_valid && !m_ready) total_output_stalls = total_output_stalls + 1;
            if (s_valid && !s_ready) total_input_stalls = total_input_stalls + 1;
            if (m_valid && m_ready) begin
                if (!allow_output) $fatal(1, "Unexpected output from incomplete frame");
                if (expected_frame >= FRAMES) $fatal(1, "Extra output frame");
                if (m_last !== (frame_bin == N-1)) $fatal(1, "TLAST not at bin 1023");
                if ($isunknown({fft_data,m_data})) $fatal(1, "Unknown output data");
                $fdisplay(fd, "%0d,%0d,%0d,%0d,%0d,%0d,%0d", expected_frame, frame_bin,
                    $signed(fft_data[15:0]), $signed(fft_data[31:16]), m_data, m_last, cycle);
                output_count = output_count + 1;
                frame_bin = frame_bin + 1;
                if (frame_bin == N) begin
                    $display("FRAME_COMPLETE frame=%0d cycle=%0d", expected_frame, cycle);
                    expected_frame = expected_frame + 1;
                    frame_bin = 0;
                end
            end
        end
    end

    task send_sample(input [15:0] value, input bit last, input bit gaps);
        integer gap;
        begin
            gap = gaps ? (random_state[5:4]) : 0;
            repeat(gap) begin
                @(negedge clk); s_valid = 0; s_last = 0;
            end
            @(negedge clk);
            s_data = value; s_valid = 1; s_last = last;
            @(posedge clk);
            while (!s_ready) @(posedge clk);
        end
    endtask

    task reset_core;
        begin
            @(negedge clk); rst_n = 0; s_valid = 0; s_last = 0;
            repeat (12) @(negedge clk);
            rst_n = 1; reset_count = reset_count + 1;
            repeat (32) @(negedge clk);
        end
    endtask

    initial begin
        $readmemh("input.hex", input_mem);
        fd = $fopen("spectrum.csv", "w");
        if (!fd) $fatal(1, "Cannot open output CSV");
        $fdisplay(fd, "frame,bin,re,im,mag,last,cycle");
        reset_core();
        for (integer f = 0; f < FRAMES; f = f+1) begin
            if (f == 8) begin
                @(negedge clk); s_valid = 0; s_last = 0;
                wait(output_count == 8*N);
                allow_output = 0;
                for (integer p=0; p<137; p=p+1) send_sample(16'd12345, 0, 0);
                reset_core();
                allow_output = 1;
            end
            for (integer n=0; n<N; n=n+1)
                send_sample(input_mem[f*N+n], n == N-1, f >= 8);
        end
        @(negedge clk); s_valid = 0; s_last = 0;
        wait (output_count == FRAMES*N);
        repeat (100) @(negedge clk);
        $fclose(fd);
        if (total_output_stalls == 0 || total_input_stalls == 0) $fatal(1, "Backpressure not exercised");
        $display("SPECTRUM_PROTOCOL_PASS frames=%0d bins=%0d resets=%0d input_stalls=%0d output_stalls=%0d", FRAMES, output_count, reset_count, total_input_stalls, total_output_stalls);
        $finish;
    end
    initial begin
        #5000000;
        $fatal(1, "TIMEOUT outputs=%0d", output_count);
    end
endmodule
