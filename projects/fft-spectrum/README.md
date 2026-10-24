# 1024 点 FFT 本机复刻

Vivado 2020.2 / Artix-7 `xc7a100tfgg676-2`：流式输入 → AMD FFT 9.1 → L1 幅度。已通过 16 帧数值/协议验收；100 MHz 核内布局布线报告为正余量，时钟源及接口位置仍待实际集成后确认，详见[成绩单](../../docs/codex-vivado-score-2026-10-23.md)。

在工作区根目录运行以下命令，直接调用已有原生工具，**不创建模型会话、不调用其他模型 API**：

```powershell
cd ${WORKSPACE}
node scripts/eda-tool.mjs eda_vivado projects/fft-spectrum/simulate-call.json
node scripts/eda-tool.mjs eda_vivado projects/fft-spectrum/implement-call.json
```

每次写入新的 `artifacts/` 目录，路径由工具输出返回。成功运行会更新 `latest-simulation.txt` / `latest-implementation.txt`。成绩单中的运行记录保留本次结果。仿真 oracle 需要本机 Python、NumPy、Matplotlib；依赖和工具已在当前环境验证。

`tb_spectrum.sv`、`vectors/input.hex` 和 `oracle.py` 为固定验收材料，哈希在 `acceptance-hashes.json`。`check-negative-controls.py` 检查四种破坏后的输出是否被拒绝。`python scripts/assess-vivado.py` 从本次已有报告重新核对并汇总成绩，不重跑设计。

小题可用 `node scripts/verilogeval-mini.mjs` 重新执行，使用当前 `projects/verilogeval-mini/solutions/`。其中 mux 已看过参考后修正；复跑结果不能替代保存在 artifacts 中的首次 7/8 成绩。

`view-simulation.tcl` 用于 GUI 打开已验收波形；`capture-vivado.ps1 -VivadoProcessId <PID>` 仅截取指定 Vivado 窗口，保存到 Windows 图片目录。报告中的截图为真实工具界面。

源头为 [SynthPilot_Tutorial](https://github.com/LNC0831/SynthPilot_Tutorial)，固定提交见成绩单。上游幅度模块未改，FFT 来自 AMD IP。当前只验收 DSP 核，未验证 PCIe、实际板卡 IO 或硬件；未生成 bitstream。上游未发现独立 LICENSE，本次仅作本地参考。
