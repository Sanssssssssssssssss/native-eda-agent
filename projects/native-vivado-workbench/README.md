# Native Vivado Workbench

现有 `eda-local` / Pi 原生工具新增 `eda_vivado_optimize`，执行 RouteAgents 特征路由与 AER 停止规则组织的本地优化循环。见[实现、实测和用法](../../docs/native-optimizer-2026-10-24.md)。默认 `mode=plan`，其他模型 API 保持停用；示例参数为本目录 `optimizer-plan.json` 和 `optimizer-run.json`。

当前 Codex / Pi 已配置 `vivado-community`：**45 个工具、11 个工作流 Prompt**，后端是本机 Vivado 2020.2。上游 [mapleleavessssssss-wq/vivado-mcp](https://github.com/mapleleavessssssss-wq/vivado-mcp) 固定提交 `41745b29af31a34d9b6756a9105313215d9f568e`，Apache-2.0；本地 `src/vivado_workbench.py` 加入 13 个工程/IP/BD 工具。

入口：`${WORKSPACE}\src\vivado_workbench.py`；独立解释器：`${WORKSPACE}\runtime\vivado-community-venv\Scripts\python.exe`。重连项目 MCP 后加载。其他模型 API 当前保持停用。

可直接交给当前 Codex 的任务：

> 用 vivado-community 启动独立 Tcl 会话，打开指定 routed.dcp，读取 setup/hold、CDC 和资源报告；把返回值保存到新的 artifacts 目录。定位最差路径，给出保持当前时钟与 IO 约束的优化候选，结束后关闭该会话。

分析调用顺序：`start_session(mode="tcl")` → `run_tcl` / `safe_tcl` → `get_timing_report(output_format="json")` → 保存返回值 → `get_timing_report(baseline_file="绝对路径")` → `stop_session`。VCD 使用 `query_waveform`；IP 参数使用 `inspect_ip_params`，XCI 差异使用 `compare_xci`。

工程装配调用顺序：`wb_project_create` → `wb_project_add_files` → `wb_ip_create/configure/generate`；BD 使用 `wb_bd_create` → `wb_bd_add_ip` → `wb_bd_connect/external` → `wb_bd_assign_address` → `wb_bd_validate_export` → `wb_project_export`。每次传入同一个 `session_id` 和明确 `project_dir`，BD 操作另传 `bd_name`。工具返回 JSON 的 `ok` 和独立回执目录；操作失败可能部分生效，应先读取 `output.log` 与当前工程状态。

本地验证：原上游 998 项测试通过、3 跳过，原集成 13/13 通过；新增工程/IP/BD 最终 **33/33** 检查通过，包括 13 个新工具、错误输入拒绝、真实 IP 生成、双 GPIO AXI 连接、地址读回、HDL 导出与工程重建。示例工程：`${WORKSPACE}\projects\wb test-1024-082415\axi_workbench.xpr`。完整说明见 [工程覆盖报告](../../docs/vivado-workbench-coverage-2026-10-24.md)。这些是集成检查数量，本轮示例没有功能仿真或布线成绩。

会话队列独立于 `eda-local` 的资源锁与 trace，跨后端真实 Vivado 任务串行安排。新 `wb_*` 工具有 Tcl/输出/结果回执；输入输出使用工作区内绝对路径。工程导出依赖原源文件，保留原始及修正空格路径后的 Tcl。优化结果仍需固定约束和独立功能验证。GUI、上板和完整自动优化尚未验收。

复跑：

```powershell
cd ${WORKSPACE}
runtime\vivado-community-venv\Scripts\python.exe scripts\validate-vivado-workbench.py
```

AMD 官方起始框架在 `${WORKSPACE}\vendor\fpl26-optimization-contest`，包含优化循环、Vivado/RapidWright 后端和 DCP 验收器。官方决赛 AER 第一、RouteAgents 第二，可作为策略与编排参考。当前 Windows/Vivado 2020.2 尚未满足竞赛 Vivado 2025.1 / POSIX 执行要求，未运行获奖方案或 OpenRouter 入口。
