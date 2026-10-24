# Data-only JSON helpers and bounded Vivado 2020.2-compatible queries.
namespace eval eda {}
proc eda::str {value} {
    set out "\""
    foreach c [split $value ""] {
        scan $c %c n
        if {$c eq "\"" || $c eq "\\"} {append out "\\$c"} elseif {$n < 32} {append out [format {\u%04x} $n]} else {append out $c}
    }
    append out "\""
    return $out
}
proc eda::num {value} {
    if {[regexp {^-?[0-9]+(?:\.[0-9]*)?(?:[eE][+-]?[0-9]+)?$} $value]} {return $value}
    return null
}
proc eda::arr {items} {return "\[[join $items ,]\]"}
proc eda::obj {fields} {
    set entries {}
    dict for {key value} $fields {lappend entries "[eda::str $key]:$value"}
    return "\{[join $entries ,]\}"
}
proc eda::prop {object property} {
    if {[llength $object] != 1 || [catch {get_property $property $object} value]} {return ""}
    return $value
}
proc eda::write {fields} {
    dict set fields version [eda::str [version -short]]
    set f [open fpga-result.json w]; fconfigure $f -encoding utf-8
    puts $f [eda::obj $fields]; close $f
}
proc eda::catalog {kind pattern maximum} {
    switch $kind {
        commands {set all [lsort [info commands $pattern]]}
        parts {set all [lsort [get_parts -quiet $pattern]]}
        ips {create_project -in_memory; set all [lsort [get_ipdefs -quiet -all $pattern]]}
        default {error "Unsupported catalog"}
    }
    set entries {}; foreach value [lrange $all 0 [expr {$maximum-1}]] {lappend entries [eda::str $value]}
    eda::write [dict create kind [eda::str $kind] total [llength $all] items [eda::arr $entries]]
}
proc eda::objects {kind pattern maximum} {
    switch $kind {
        cells {set all [get_cells -hier -quiet $pattern]; set props {REF_NAME IS_PRIMITIVE IS_BLACKBOX LOC BEL}}
        nets {set all [get_nets -hier -quiet $pattern]; set props {IS_CLOCK ROUTE_STATUS}}
        ports {set all [get_ports -quiet $pattern]; set props {DIRECTION IOSTANDARD PACKAGE_PIN}}
        pins {set all [get_pins -hier -quiet $pattern]; set props {DIRECTION REF_PIN_NAME}}
        clocks {set all [get_clocks -quiet $pattern]; set props {PERIOD WAVEFORM IS_GENERATED}}
        default {error "Unsupported object kind"}
    }
    set entries {}
    foreach item [lrange $all 0 [expr {$maximum-1}]] {
        set fields [dict create name [eda::str $item]]
        foreach p $props {dict set fields $p [eda::str [eda::prop $item $p]]}
        lappend entries [eda::obj $fields]
    }
    eda::write [dict create kind [eda::str $kind] total [llength $all] items [eda::arr $entries]]
}
proc eda::paths {delay maximum from to} {
    set command [list get_timing_paths -quiet -delay_type $delay -max_paths $maximum -nworst 1]
    foreach {flag name} [list -from $from -to $to] {
        if {$name ne ""} {
            set selected {}
            foreach clock [get_clocks -quiet] {if {$clock eq $name} {lappend selected $clock}}
            if {[llength $selected] != 1} {error "Clock name did not resolve exactly: $name"}
            lappend command $flag $selected
        }
    }
    set all [{*}$command]; set entries {}
    foreach item $all {
        set fields [dict create startpoint [eda::str [eda::prop $item STARTPOINT_PIN]] endpoint [eda::str [eda::prop $item ENDPOINT_PIN]] slack_ns [eda::num [eda::prop $item SLACK]] requirement_ns [eda::num [eda::prop $item REQUIREMENT]] logic_levels [eda::num [eda::prop $item LOGIC_LEVELS]]]
        lappend entries [eda::obj $fields]
    }
    eda::write [dict create delay_type [eda::str $delay] returned [llength $all] limit $maximum paths [eda::arr $entries] whole_design_tns null]
}
proc eda::reports {names stage} {
    set fields [dict create stage [eda::str $stage] design [eda::str [current_design]] part [eda::str [eda::prop [current_design] PART]]]
    set clocks {}; foreach c [get_clocks -quiet] {lappend clocks [eda::obj [dict create name [eda::str $c] period_ns [eda::num [eda::prop $c PERIOD]]]]}
    dict set fields clocks [eda::arr $clocks]
    dict set fields black_boxes [llength [get_cells -hier -quiet -filter {IS_BLACKBOX == 1}]]
    set report_entries {}; set failures 0
    foreach name $names {
        switch $name {
            timing {set command {report_timing_summary -report_unconstrained -file timing.rpt}}
            utilization {set command {report_utilization -file utilization.rpt}}
            cdc {set command {report_cdc -details -file cdc.rpt}}
            drc {set command {report_drc -file drc.rpt}}
            methodology {set command {report_methodology -file methodology.rpt}}
            clocks {set command {report_clocks -file clocks.rpt}}
            exceptions {set command {report_exceptions -file exceptions.rpt}}
            route {set command {report_route_status -file route.rpt}}
            default {error "Unsupported report"}
        }
        set status ok; set message ""
        if {[catch {{*}$command} message]} {set status failed; incr failures}
        # Command return text may be large; raw reports and process.log retain it.
        lappend report_entries [eda::obj [dict create name [eda::str $name] status [eda::str $status] error [eda::str [expr {$status eq "failed" ? $message : ""}]]]]
    }
    if {[lsearch -exact $names timing]>=0} {
        check_timing -verbose -file check-timing.rpt
        foreach {delay key} {max setup_slack_ns min hold_slack_ns} {
            set p [get_timing_paths -quiet -delay_type $delay -max_paths 1]
            dict set fields $key [eda::num [eda::prop $p SLACK]]
        }
    }
    dict set fields reports [eda::arr $report_entries]
    eda::write $fields
    if {$failures} {error "EDA_REPORT_FAILURE: $failures requested report(s) failed; see fpga-result.json"}
}
