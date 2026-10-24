`timescale 1ns/1ps
`default_nettype none
module tb_aes #(parameter CHECKER_CORRUPT=0);
    `include "E:/GPTProject2/EDAAgent/projects/system-bench/aes/vector-config.svh"
    reg clk=0;
    always #5 clk=~clk;
    reg rst=1;
    reg [255:0] key_data=0;
    reg key_256=0, key_valid=0;
    wire key_ready;
    reg [127:0] s_data=0;
    reg s_encrypt=0;
    reg [15:0] s_tag=0;
    reg s_last=0, s_valid=0;
    wire s_ready;
    wire [127:0] m_data;
    wire [15:0] m_tag;
    wire m_last, m_valid;
    reg m_ready=0;
    wire key_loaded,busy;
    aes_stream_top dut(.*);

    reg [255:0] keys [0:VECTOR_COUNT-1];
    reg [127:0] inputs [0:VECTOR_COUNT-1];
    reg [127:0] expected [0:VECTOR_COUNT-1];
    reg [15:0] tags [0:VECTOR_COUNT-1];
    integer keylens [0:VECTOR_COUNT-1];
    integer encrypts [0:VECTOR_COUNT-1];
    integer lasts [0:VECTOR_COUNT-1];
    integer groups [0:VECTOR_COUNT-1];
    integer file_handle, scanned, i, g, first;
    integer cycles=0, accepted=0, checked=0, encrypted=0, decrypted=0;
    integer input_stall_cycles=0, output_stall_cycles=0, key_stall_cycles=0;
    integer input_queue_peak=0, output_queue_peak=0, resets_checked=0;
    integer operation_cycles_start=0;
    reg checking=0, traffic_phase=0, held=0;
    reg [144:0] held_payload;
    reg [31:0] ready_rng=32'hb22a9871;

    always @(negedge clk) begin
        ready_rng <= {ready_rng[30:0],ready_rng[31]^ready_rng[21]^ready_rng[1]^ready_rng[0]};
        if (traffic_phase)
            m_ready <= (cycles%2500>=900) && (ready_rng[0] || ready_rng[3]);
        else m_ready <= 0;
    end

    always @(posedge clk) begin
        cycles=cycles+1;
        if (rst) held=0;
        else begin
            if (held && (!m_valid || {m_last,m_tag,m_data} !== held_payload))
                $fatal(1,"AES output changed while backpressured at cycle %0d",cycles);
            held=m_valid&&!m_ready;
            held_payload={m_last,m_tag,m_data};
            if (checking) begin
                if (s_valid&&!s_ready) input_stall_cycles=input_stall_cycles+1;
                if (m_valid&&!m_ready) output_stall_cycles=output_stall_cycles+1;
                if (key_valid&&!key_ready) key_stall_cycles=key_stall_cycles+1;
                if (dut.in_count>input_queue_peak) input_queue_peak=dut.in_count;
                if (dut.out_count>output_queue_peak) output_queue_peak=dut.out_count;
                if (s_valid&&s_ready) accepted=accepted+1;
                if (m_valid&&m_ready) begin
                    if (checked>=VECTOR_COUNT) $fatal(1,"Unexpected additional AES output");
                    if (m_data !== expected[checked] || m_tag !== tags[checked] || m_last !== lasts[checked][0])
                        $fatal(1,"AES mismatch block=%0d group=%0d actual=%032h expected=%032h tag=%h last=%b",
                               checked,groups[checked],m_data,expected[checked],m_tag,m_last);
                    if(encrypts[checked]) encrypted=encrypted+1;
                    else decrypted=decrypted+1;
                    checked=checked+1;
                end
            end
        end
    end

    task automatic reset_and_check;
        begin
            @(negedge clk);
            rst=1; key_valid=0; s_valid=0;
            repeat(4) @(negedge clk);
            if(m_valid!==0 || s_ready!==0) $fatal(1,"AES outputs not suppressed in reset");
            rst=0;
            repeat(3) @(negedge clk);
            if(m_valid!==0 || key_loaded!==0 || key_ready!==1 || s_ready!==0)
                $fatal(1,"AES reset failed to flush data and key state");
            resets_checked=resets_checked+1;
        end
    endtask

    task automatic load_key(input integer n);
        integer waited;
        begin
            @(negedge clk);
            key_data=keys[n]; key_256=keylens[n]; key_valid=1;
            waited=0;
            @(posedge clk);
            while(!key_ready) begin
                waited=waited+1;
                if(waited>20000) $fatal(1,"AES key barrier did not drain");
                @(posedge clk);
            end
            @(negedge clk); key_valid=0;
            waited=0;
            while(!key_loaded) begin
                waited=waited+1;
                if(waited>200) $fatal(1,"AES key expansion failed to complete");
                @(negedge clk);
            end
        end
    endtask

    task automatic send_block(input integer n);
        integer waited;
        begin
            repeat((n*3+1)%4) @(negedge clk);
            @(negedge clk);
            s_data=inputs[n]; s_encrypt=encrypts[n]; s_tag=tags[n];
            s_last=lasts[n]; s_valid=1;
            waited=0;
            @(posedge clk);
            while(!s_ready) begin
                waited=waited+1;
                if(waited>20000) $fatal(1,"AES stream input deadlock");
                @(posedge clk);
            end
            @(negedge clk); s_valid=0;
        end
    endtask

    initial begin
        file_handle=$fopen(VECTOR_FILE,"r");
        if(!file_handle) $fatal(1,"Cannot open independent AES vectors");
        for(i=0;i<VECTOR_COUNT;i=i+1) begin
            scanned=$fscanf(file_handle,"%h %d %d %h %h %h %d %d\n",
                keys[i],keylens[i],encrypts[i],inputs[i],expected[i],tags[i],lasts[i],groups[i]);
            if(scanned!=8) $fatal(1,"Malformed AES vector at %0d",i);
        end
        $fclose(file_handle);
        if(CHECKER_CORRUPT) expected[0]=expected[0]^128'h1;
        reset_and_check();
        // Reset during key expansion.
        @(negedge clk); key_data=keys[1];key_256=keylens[1];key_valid=1;
        @(posedge clk);
        if(!key_ready) $fatal(1,"Expected empty accelerator ready for key");
        @(negedge clk); key_valid=0;
        repeat(3) @(negedge clk);
        reset_and_check();
        // Reset during a real AES operation with queued work.
        load_key(0);
        send_block(0);
        send_block(1);
        repeat(5) @(negedge clk);
        if(!busy) $fatal(1,"Busy reset scenario did not reach active work");
        reset_and_check();
        // Reset while a completed result is held under output backpressure.
        load_key(2);
        send_block(2);
        wait(m_valid);
        repeat(19) @(negedge clk);
        reset_and_check();

        @(negedge clk); checking=1;traffic_phase=1;operation_cycles_start=cycles;
        first=0;
        for(g=0;g<GROUP_COUNT;g=g+1) begin
            load_key(first);
            while(first<VECTOR_COUNT && groups[first]==g) begin
                send_block(first);
                first=first+1;
            end
            $display("AES_GROUP_SENT group=%0d accepted=%0d checked=%0d",g,accepted,checked);
        end
        wait(checked==VECTOR_COUNT);
        repeat(20) @(negedge clk);
        if(accepted!=VECTOR_COUNT || encrypted!=VECTOR_COUNT/2 || decrypted!=VECTOR_COUNT/2)
            $fatal(1,"AES operation accounting failed");
        if(input_queue_peak!=8 || output_queue_peak!=8 || input_stall_cycles==0 || output_stall_cycles==0 || key_stall_cycles==0)
            $fatal(1,"AES stress coverage not reached: input=%0d output=%0d",input_queue_peak,output_queue_peak);
        $display("AES_METRICS cycles=%0d input_stalls=%0d output_stalls=%0d key_stalls=%0d input_peak=%0d output_peak=%0d",
                 cycles-operation_cycles_start,input_stall_cycles,output_stall_cycles,key_stall_cycles,input_queue_peak,output_queue_peak);
        $display("SYSTEM_BENCH_PASS project=aes blocks=%0d encrypt=%0d decrypt=%0d key_groups=%0d reset_scenarios=%0d",
                 checked,encrypted,decrypted,GROUP_COUNT,resets_checked);
        $finish;
    end
    initial begin
        #5000000;
        $fatal(1,"AES simulation watchdog: accepted=%0d checked=%0d",accepted,checked);
    end
endmodule
`default_nettype wire
