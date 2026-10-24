"""Verify frozen candidates and summarize one complete 24-task local run."""
from pathlib import Path
import hashlib
import json
import re
import sys

project = Path(__file__).resolve().parent
root = project.parents[1]
run = Path(sys.argv[1]).resolve()
selection = json.loads((project / "selection.json").read_text())
frozen = json.loads((project / "initial-candidates.json").read_text())
result = json.loads((run / "result.json").read_text())
tasks = result["tasks"]
raw_reported_passed = result["passed"]
for t in tasks:
    if "directory" in t:
        transcript = (Path(t["directory"]) / "process.log").read_text()
        t["timed_out"] = bool(re.search(r"\bTIMEOUT\b", transcript))
        t["passed"] = t["passed"] and not t["timed_out"]
assert len(tasks) == result["total"] == 24, "Wait for all tasks to finish"
assert [t["id"] for t in tasks] == selection["task_ids"]
assert result["benchmark"] == selection
assert not set(selection["task_ids"]) & set(json.loads((root / "projects/verilogeval-mini/selection.json").read_text())["task_ids"])
for t in tasks:
    candidate = hashlib.sha256((run / (t["id"] + ".sv")).read_bytes()).hexdigest()
    assert candidate == frozen["candidate_sha256"][t["id"]] == t["solution_sha256"]
    assert t["prompt_sha256"] == selection["prompt_sha256"][t["id"]]
    if t["passed"]:
        assert t["mismatches"] == 0 and t["samples"] > 0

labels = {
    "combinational_arithmetic": "组合与位运算",
    "registers_edges": "寄存器与边沿",
    "counters_timers": "计数与定时",
    "shifts_lfsr_cellular": "移位与迭代逻辑",
    "control_fsm": "状态控制",
    "protocol_prediction": "协议与分支预测",
}
groups = []
for category, label in labels.items():
    selected = [t for t in tasks if t["category"] == category]
    assert len(selected) == 4
    groups.append({"category": category, "label": label, "passed": sum(t["passed"] for t in selected), "total": 4})
passed = sum(t["passed"] for t in tasks)
score = {"date": "2026-10-23", "passed": passed, "total": 24, "percent": 100 * passed / 24,
         "original_runner_reported_passed": raw_reported_passed, "scoring_correction": "Reject TIMEOUT even if mismatch count is zero",
         "categories": groups, "samples": sum(t.get("samples", 0) for t in tasks),
         "tool_failures": sum("error" in t for t in tasks), "wall_seconds": result["wall_seconds"],
         "frozen_candidates_verified": True, "previous_8_overlap": 0, "model_api_calls": 0,
         "scope": "Purposive 24-task coverage sample; one Codex conversation; XSim adapted runner; functional simulation only",
         "failed_ids": [t["id"] for t in tasks if not t["passed"]], "evidence": str(run / "result.json")}
extended_tasks = {t["id"]: t for t in tasks}
if len(sys.argv) > 2:
    extended_run = Path(sys.argv[2]).resolve()
    extended = json.loads((extended_run / "result.json").read_text())
    assert extended["test_timeout_ps_override"] == 10000000
    assert set(extended["evaluated_ids"]) == {"Prob141_count_clock", "Prob082_lfsr32", "Prob156_review2015_fancytimer"}
    for t in extended["tasks"]:
        task_id = t["id"]
        assert t["solution_sha256"] == frozen["candidate_sha256"][task_id]
        assert hashlib.sha256((extended_run / (task_id + ".sv")).read_bytes()).hexdigest() == t["solution_sha256"]
        assert t["prompt_sha256"] == selection["prompt_sha256"][task_id]
        # Only the watchdog duration changes in the already adapted testbench.
        original_test = (run / (task_id + "_test.sv")).read_text()
        assert (extended_run / (task_id + "_test.sv")).read_text() == re.sub(r'#1000000(\s+\$display\("TIMEOUT"\))', r'#10000000\1', original_test)
        assert (extended_run / (task_id + "_ref.sv")).read_text() == (run / (task_id + "_ref.sv")).read_text() + '\n`default_nettype wire\n'
        transcript = (Path(t["directory"]) / "process.log").read_text()
        assert t["passed"] and t["mismatches"] == 0 and t["samples"] > 0 and not re.search(r"\bTIMEOUT\b", transcript)
        extended_tasks[task_id] = t
    extended_passed = sum(t["passed"] for t in extended_tasks.values())
    score["extended_watchdog"] = {"passed": extended_passed, "total": 24, "percent": extended_passed / 24 * 100,
        "watchdog_ps": 10000000, "original_watchdog_ps": 1000000,
        "samples": sum(t.get("samples", 0) for t in extended_tasks.values()), "additional_wall_seconds": extended["wall_seconds"],
        "candidate_rtl_changes": 0, "functional_stimulus_or_comparison_changes": 0,
        "evidence": str(extended_run / "result.json")}
    for g in groups:
        g["extended_passed"] = sum(t["passed"] for t in extended_tasks.values() if t["category"] == g["category"])
usage_file = run / "codex-usage.json"
if usage_file.exists():
    score["codex_usage"] = json.loads(usage_file.read_text(encoding="utf-8"))
(run / "score.json").write_text(json.dumps(score, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
lines = ["# Codex 24 题代表性覆盖实测", "",
         f"2026-10-23：按原始测试规则计 **{passed}/24 = {score['percent']:.2f}%**。24 题与前一轮 8 题无重复，按六类各四题提前固定；额外模型 API 调用 **0 次**。", "",
         "早期运行器漏判 TIMEOUT，原始 result.json 保留当时记录；本报告已按上游判分规则纠正。零 mismatch 加超时仍判失败。", ""]
if "extended_watchdog" in score:
    e = score["extended_watchdog"]
    lines += [f"延长 3 道长测试的 watchdog 并隔离 testbench 的编译指令后，同一份候选 RTL 为 **{e['passed']}/24 = {e['percent']:.2f}%**，完整比较 {e['samples']:,} 个样本；另耗时 {e['additional_wall_seconds']:.2f} 秒。候选 RTL 修改 0 处，功能激励和比较逻辑修改 0 处。扩展结果不替代原始规则成绩。", ""]
lines += ["| 类别 | 原始规则 | 延长测试后 |", "|---|---:|---:|"]
lines += [f"| {g['label']} | {g['passed']}/4 | {g.get('extended_passed', g['passed'])}/4 |" for g in groups]
lines += ["", f"共比较 **{score['samples']:,} 个样本**，本地工具耗时 **{score['wall_seconds']:.2f} 秒**；工具失败 **{score['tool_failures']} 题**。耗时不含 Codex 思考、编写和报告整理。", "",
          "每题仿真完成、无超时、检查样本大于零且 mismatch 为零才计通过。总体分数是通过题数 / 24；每类等权。样本数只反映仿真工作量，不作为独立题目数或统计置信度。", "",
          "| 题号 | 类别 | 原始结果 | 延长测试后 | 原始不匹配 / 样本 |", "|---|---|---|---|---:|"]
for t in tasks:
    status = "通过" if t["passed"] else "工具失败" if "error" in t else "测试超时" if t.get("timed_out") else "功能失败"
    extended_status = "通过" if extended_tasks[t["id"]]["passed"] else "未通过"
    lines.append(f"| {t['id']} | {labels[t['category']]} | {status} | {extended_status} | {t.get('mismatches', '—')} / {t.get('samples', 0)} |")
lines += ["", "候选、题目及每题原始日志路径见 [result.json](result.json)，汇总见 [score.json](score.json)。候选哈希已与测试前冻结记录逐一核对。", "",
          "这是定向覆盖题集，全部在同一 Codex 会话中作答；不是随机总体估计、完整 156 题成绩或独立会话的模型排行榜 pass@1。本轮未运行综合、时序、形式验证或硬件测试。24 份候选共 327 行，每题 4～36 行，属于单模块小题。费用未估算。", "",
          "运行器使用 XSim 2020.2：参考副本补 timescale，TB 两个 wire 声明前移，激励和判定逻辑保持原样。首次成绩保留，任何之后的诊断或修复另行标记。", ""]
if usage_file.exists():
    usage = score["codex_usage"]["delta"]
    lines += [f"本地会话日志记录本轮输出 {usage['output_tokens']:,} tokens，其中推理 {usage['reasoning_output_tokens']:,}；额外模型 API 调用 0 次不代表当前 Codex 没有用量。详见 [用量记录](codex-usage.json)。", ""]
(run / "report.md").write_text("\n".join(lines), encoding="utf-8")
print(json.dumps(score, ensure_ascii=False, indent=2))
