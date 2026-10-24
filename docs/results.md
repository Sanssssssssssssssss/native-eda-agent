# 历史成绩与复核

已将 11 组历史结果接入原生 Agent。入口为 `eda_results_list/get/verify/compare`，或 `node scripts/results.mjs`。完整记录见 [catalog.json](../results/catalog.json)，每项附原文件路径/哈希及经过路径脱敏的公开证据/哈希。

计分单位包括 RTL 题、case variant、系统工程、工具检查、优化运行和软件测试。系统内部 seeds、事务、字节不计为独立项目。相同任务重跑不增加题量；改变 watchdog 后的结果保留独立协议。

`verify` 检查公开文件及当前可找到的原文件。公开仓库中原始 DCP、波形及运行目录不随包分发，显示 `unavailable`；这不等同于失败，也不等同于独立复现。文件哈希不是数字签名或第三方证明。

`compare` 要求 task_set、protocol、scope、unit 一致，且证据完整；否则拒绝给出 pass_delta。没有跨全部成绩的总分。61 项原始 campaign 的 TIMEOUT 不因后续单独复跑而消失。

来源包括固定 8/24 题、FFT、四系统、三复杂系统、61 case campaign、12/33 次工具验收、零收益优化实跑，以及 2026-10-24 的 64 项离线软件验收。当前版本的软件验证记录见 [本轮发布](release-2026-10-25.md)，不可当成新增 FPGA 实跑成绩。

开发者在保留完整历史 artifacts 的工作区运行 `node scripts/import-historical-results.mjs` 可重新生成索引；公开 checkout 不具备这些原始文件，应直接查询已导出的索引。导入脚本不运行 EDA，也不补造旧 trace span。
