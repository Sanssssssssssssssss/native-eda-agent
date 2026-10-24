`timescale 1ps/1ps
module kmap_spec_tb;
    reg c, d;
    wire [3:0] candidate, reference;
    reg [3:0] expected;
    integer i, reference_disagreements;
    TopModule dut(.c(c),.d(d),.mux_in(candidate));
    RefModule ref_dut(.c(c),.d(d),.mux_in(reference));
    initial begin
        reference_disagreements = 0;
        for (i=0; i<4; i=i+1) begin
            {c,d} = i;
            // Transcribed from the prompt's K-map, with index={a,b}.
            case (i)
                0: expected = 4'b0100;
                1: expected = 4'b0001;
                2: expected = 4'b0101;
                3: expected = 4'b1101;
            endcase
            #1;
            $display("SPEC_ROW c=%b d=%b expected=%b candidate=%b reference=%b",c,d,expected,candidate,reference);
            if (candidate !== expected) $fatal(1,"Candidate violates prompt K-map");
            if (reference !== expected) reference_disagreements = reference_disagreements + 1;
        end
        if (reference_disagreements != 1) $fatal(1,"Unexpected reference disagreement count");
        $display("KMAP_SPEC_DIAGNOSTIC_PASS rows=4 cells=16 reference_disagreements=1");
        $finish;
    end
endmodule
