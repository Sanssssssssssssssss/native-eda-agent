`timescale 1ns/1ps
`default_nettype none
module tb_crypto_soc #(parameter INJECT_FAULT=0,WARM_RESET=0,SEED_COUNT=3);
    reg clk=0;always #5 clk=~clk;
    reg resetn=0;reg [31:0] seed=1;reg [2:0] stall_mask=0;
    wire trap,result_valid,done,dma_busy;
    wire [31:0] result_data,result_tag,finish_code,firmware_work;
    wire [31:0] cpu_grants,dma_grants,both_pending,owner_switches,cpu_during_dma,irq_handled;
    crypto_soc_top dut(.*);
    reg [7:0] expected_bytes[0:26591];
    reg [31:0] expected_crc[0:41],offsets[0:41],lengths[0:13],seeds[0:2];
    integer run_id,cycles,crc_checks,error_checks,misc_checks,j,address,offset;
    integer total_cycles=0,total_bytes=0,total_overlap=0,total_switches=0,total_work=0;
    reg checking=0,faulted=0,held_dma=0;
    reg [67:0] held_dma_request;
    integer reset_probes=0;
    integer accepted_commands=0,active_command=0,observed_writes=0,observed_beats=0;
    integer observed_error_checks=0,observed_good_checks=0,observed_total_bytes=0;
    integer expected_command_bytes,strobe_count,lane;
    integer error_written_bytes[0:6];
    reg [6:0] independently_checked_errors=0;
    reg command_active=0;
    // Independent bus observer: count physical DMA handshakes, not the DMA's
    // completed/bytes_written self-report. Accepted doorbells alternate bad/good.
    always @(posedge clk)begin
        if(!resetn)begin
            accepted_commands=0;active_command=0;observed_writes=0;observed_beats=0;
            observed_error_checks=0;observed_good_checks=0;observed_total_bytes=0;
            independently_checked_errors=0;command_active=0;
            for(lane=0;lane<7;lane=lane+1)error_written_bytes[lane]=0;
        end else begin
            if(dut.start_pulse&&!dma_busy)begin
                if(command_active)$fatal(1,"DOORBELL_ACCEPTED_WITH_UNFINISHED_COMMAND");
                active_command=accepted_commands;accepted_commands=accepted_commands+1;
                observed_writes=0;observed_beats=0;command_active=1;
            end
            if(dut.d_valid&&dut.d_ready&&|dut.d_wstrb)begin
                if(!command_active)$fatal(1,"DMA_WRITE_WITHOUT_ACCEPTED_COMMAND");
                strobe_count=0;
                for(lane=0;lane<4;lane=lane+1)if(dut.d_wstrb[lane])strobe_count=strobe_count+1;
                observed_writes=observed_writes+strobe_count;
                observed_beats=observed_beats+1;
                observed_total_bytes=observed_total_bytes+strobe_count;
                if(active_command%2==0&&active_command/2<6)
                    $fatal(1,"INVALID_DESCRIPTOR_CAUSED_ACTUAL_WRITE kind=%0d address=%h strobes=%b",active_command/2,dut.d_addr,dut.d_wstrb);
            end
            if(command_active&&dut.irq)begin
                if(active_command%2==0)begin
                    expected_command_bytes=active_command/2==6?512:0;
                    if(observed_writes!=expected_command_bytes)
                        $fatal(1,"ERROR_TRANSACTION_ACTUAL_WRITE_COUNT kind=%0d actual=%0d expected=%0d",active_command/2,observed_writes,expected_command_bytes);
                    error_written_bytes[active_command/2]=observed_writes;
                    independently_checked_errors[active_command/2]=1;
                    observed_error_checks=observed_error_checks+1;
                end else begin
                    expected_command_bytes=lengths[(active_command/2)*2]*2;
                    if(observed_writes!=expected_command_bytes)
                        $fatal(1,"GOOD_CHAIN_ACTUAL_WRITE_COUNT group=%0d actual=%0d expected=%0d",active_command/2,observed_writes,expected_command_bytes);
                    observed_good_checks=observed_good_checks+1;
                end
                $display("CRYPTO_WRITE_OBSERVER seed=%h command=%0d bad=%0d bytes=%0d beats=%0d",seed,active_command,active_command%2==0,observed_writes,observed_beats);
                command_active=0;
            end
        end
    end
    always @(posedge clk)begin
        if(!resetn)held_dma=0;
        else begin
            if(held_dma&&(!dut.d_valid||{dut.d_addr,dut.d_wdata,dut.d_wstrb}!==held_dma_request))
                $fatal(1,"DMA_REQUEST_CHANGED_UNDER_STALL");
            held_dma=dut.d_valid&&!dut.d_ready;
            held_dma_request={dut.d_addr,dut.d_wdata,dut.d_wstrb};
            if(dut.d_valid&&dut.d_addr>=65536)$fatal(1,"DMA_OUT_OF_RAM_ADDRESS %h",dut.d_addr);
        end
    end
    always @(negedge clk)begin
        if(INJECT_FAULT&&checking&&!faulted&&dut.d_valid&&dut.d_ready&&|dut.d_wstrb)begin
            dut.memory.ram[dut.d_addr[15:2]]=dut.memory.ram[dut.d_addr[15:2]]^32'h1;
            faulted=1;
            $display("FAULT_INJECTED ciphertext_ram_address=%h",dut.d_addr);
        end
    end
    task automatic reboot(input integer which,input integer restore_image);
        begin
            @(negedge clk);resetn=0;checking=0;
            seed=seeds[which];stall_mask=which==0?0:(which==1?3:7);
            repeat(8)@(negedge clk);
            if(restore_image)
                $readmemh("E:/GPTProject2/EDAAgent/projects/hard-bench/crypto-soc/firmware.hex",dut.memory.ram);
            resetn=1;cycles=0;crc_checks=0;error_checks=0;misc_checks=0;
        end
    endtask
    task automatic observe;
        begin
            if(trap)$fatal(1,"CPU_TRAP run=%0d pc=%h",run_id,dut.cpu.reg_pc);
            if(done&&finish_code!==32'h600dcafe)$fatal(1,"FIRMWARE_FAIL run=%0d code=%h",run_id,finish_code);
            if(result_valid)begin
                if(result_tag<14)begin
                    if(result_tag!=crc_checks)$fatal(1,"OUT_OF_ORDER_FIRMWARE_CRC");
                    if(result_data!==expected_crc[run_id*14+result_tag])$fatal(1,"HOST_CRC_MISMATCH run=%0d descriptor=%0d",run_id,result_tag);
                    offset=offsets[run_id*14+result_tag];
                    address=32'h9000+(result_tag%2)*32'h1200;
                    for(j=0;j<lengths[result_tag];j=j+1)
                        if(((dut.memory.ram[(address+j)>>2]>>(((address+j)&3)*8))&32'hff)!=={24'b0,expected_bytes[offset+j]})
                            $fatal(1,"CIPHERTEXT_BYTE_MISMATCH run=%0d descriptor=%0d byte=%0d",run_id,result_tag,j);
                    for(j=0;j<8;j=j+1)
                        if(((dut.memory.ram[(address+lengths[result_tag]+j)>>2]>>(((address+lengths[result_tag]+j)&3)*8))&32'hff)!==32'ha5)
                            $fatal(1,"TAIL_GUARD_OVERWRITE descriptor=%0d",result_tag);
                    for(j=1;j<=4;j=j+1)
                        if(((dut.memory.ram[(address-j)>>2]>>(((address-j)&3)*8))&32'hff)!==32'ha5)
                            $fatal(1,"HEAD_GUARD_OVERWRITE descriptor=%0d",result_tag);
                    total_bytes=total_bytes+lengths[result_tag];crc_checks=crc_checks+1;
                    $display("CRYPTO_DESCRIPTOR_PASS seed=%h descriptor=%0d length=%0d crc=%h",seed,result_tag,lengths[result_tag],result_data);
                end else if(result_tag>=100&&result_tag<107)begin
                    if(result_tag!=100+error_checks||result_data!==(error_checks==6?6:error_checks+1))
                        $fatal(1,"ERROR_RECOVERY_STATUS_MISMATCH run=%0d tag=%0d code=%0d",run_id,result_tag,result_data);
                    if(!independently_checked_errors[error_checks]||error_written_bytes[error_checks]!=(error_checks==6?512:0))
                        $fatal(1,"MISSING_INDEPENDENT_ERROR_WRITE_CHECK");
                    if(error_checks==6)begin
                        // This bounded self-loop reuses case 10's source/key/IV.
                        offset=offsets[run_id*14+10];
                        for(j=0;j<32;j=j+1)
                            if(((dut.memory.ram[(32'h9000+j)>>2]>>((j&3)*8))&32'hff)!=={24'b0,expected_bytes[offset+j]})
                                $fatal(1,"BOUNDED_LOOP_CIPHERTEXT_MISMATCH seed=%h byte=%0d",seed,j);
                    end
                    error_checks=error_checks+1;
                end else if(result_tag>=200&&result_tag<=203)begin
                    if(result_tag!=200+misc_checks)$fatal(1,"UNEXPECTED_METRIC_TAG");
                    if(result_tag==200&&result_data<10)$fatal(1,"NO_FIRMWARE_CONCURRENT_WORK");
                    if(result_tag==201&&result_data!=14)$fatal(1,"IRQ_HANDLING_COUNT");
                    if(result_tag==202&&result_data!=1)$fatal(1,"BUSY_SUBMISSION_NOT_REJECTED");
                    if(result_tag==203&&result_data!=9376)$fatal(1,"DMA_BYTES_ACCOUNTING");
                    misc_checks=misc_checks+1;
                end else $fatal(1,"UNEXPECTED_FIRMWARE_EVENT %0d",result_tag);
            end
        end
    endtask
    initial begin
        seeds[0]=1;seeds[1]=32'h12345678;seeds[2]=32'hdeadbeef;
        $readmemh("E:/GPTProject2/EDAAgent/projects/hard-bench/crypto-soc/expected-bytes.hex",expected_bytes);
        $readmemh("E:/GPTProject2/EDAAgent/projects/hard-bench/crypto-soc/expected-crc.hex",expected_crc);
        $readmemh("E:/GPTProject2/EDAAgent/projects/hard-bench/crypto-soc/expected-offsets.hex",offsets);
        $readmemh("E:/GPTProject2/EDAAgent/projects/hard-bench/crypto-soc/case-lengths.hex",lengths);
        // Real firmware starts a long DMA; reset after RAM ciphertext writes begin.
        reboot(0,1);
        while(!(dma_busy&&dut.dma.bytes_written>=64)&&cycles<5000000)begin
            @(negedge clk);cycles=cycles+1;
            if(trap||done)$fatal(1,"RESET_PROBE_FAILED_TO_REACH_ACTIVE_DMA");
        end
        if(cycles>=5000000)$fatal(1,"RESET_PROBE_WATCHDOG");
        $display("RESET_DURING_DMA bytes_written=%0d cycles=%0d",dut.dma.bytes_written,cycles);
        reset_probes=reset_probes+1;
        for(run_id=0;run_id<SEED_COUNT;run_id=run_id+1)begin
            reboot(run_id,!(WARM_RESET&&run_id==0));checking=1;
            while(!done&&cycles<20000000)begin
                @(negedge clk);cycles=cycles+1;observe();
            end
            if(!done||crc_checks!=14||error_checks!=7||misc_checks!=4)$fatal(1,"CRYPTO_SOC_WATCHDOG_OR_MISSING_CHECKS");
            if(both_pending<100||owner_switches<100||cpu_during_dma<100||firmware_work<10||irq_handled!=14)
                $fatal(1,"MISSING_CONCURRENT_CPU_DMA_ACTIVITY");
            if(accepted_commands!=14||observed_error_checks!=7||observed_good_checks!=7||observed_total_bytes!=9376)
                $fatal(1,"INDEPENDENT_DMA_WRITE_OBSERVER_ACCOUNTING");
            $display("CRYPTO_ERROR_WRITE_CHECKS_PASS seed=%h rejected_commands_without_writes=6 bounded_loop_bytes=512 bounded_loop_ciphertext_bytes=32 good_chain_bytes=8864",seed);
            $display("CRYPTO_SOC_SEED_PASS seed=%h stall_mask=%0d cycles=%0d cpu_grants=%0d dma_grants=%0d both_pending=%0d owner_switches=%0d cpu_during_dma=%0d firmware_work=%0d irq=%0d",
                seed,stall_mask,cycles,cpu_grants,dma_grants,both_pending,owner_switches,cpu_during_dma,firmware_work,irq_handled);
            total_cycles=total_cycles+cycles;total_overlap=total_overlap+both_pending;
            total_switches=total_switches+owner_switches;total_work=total_work+firmware_work;
            checking=0;
        end
        $display("HARD_BENCH_PASS project=crypto-soc seeds=%0d descriptors=%0d ciphertext_bytes=%0d error_recoveries=%0d reset_probes=%0d ram_preserved_reset=%0d cycles=%0d both_pending=%0d owner_switches=%0d firmware_work=%0d",
            SEED_COUNT,SEED_COUNT*14,total_bytes,SEED_COUNT*7,reset_probes,WARM_RESET,total_cycles,total_overlap,total_switches,total_work);
        $finish;
    end
endmodule
`default_nettype wire
