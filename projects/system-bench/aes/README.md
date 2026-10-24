本轮 **532/532 块功能比对通过，密文 1 bit 损坏负控被拒绝，100 MHz OOC 布局布线通过**：WNS +1.084 ns，hold +0.105 ns，3,195 个物理 Slice LUT、2,903 FF，5,649 条可布线网络全部完成。最终仿真耗时 27.14 秒，物理实现耗时 180.04 秒；详细结果保存在 `result.json`。

AES-128/256 流式加速器，使用固定版本的 [secworks/aes](https://github.com/secworks/aes/tree/80dc4718e1dcbbdb4b0dd1bdb393d8f7b98981dc)（BSD-2-Clause）。上游 6 个模块保持原样；本地 wrapper 增加 8 项输入队列、8 项输出队列、标签、加解密选择和密钥切换屏障。

输入仅在 `s_valid && s_ready` 时接收；输出在 `m_valid && m_ready` 时消费。输出阻塞时数据、标签和 `last` 必须稳定。换密钥会阻止新输入，等待已接受输入和结果完全排空，再拉高 `key_ready` 接收密钥。AES-128 密钥放在 `key_data[255:128]`，AES-256 使用全部 256 位。复位清空队列并要求重新装载密钥。

532 块包含 20 个标准向量操作、512 个固定种子随机操作，266 次加密和 266 次解密，20 组密钥。Python cryptography/OpenSSL 生成独立期望值，并先核对 [FIPS 197](https://csrc.nist.gov/pubs/fips/197/final) 与 [SP 800-38A](https://csrc.nist.gov/pubs/sp/800/38/a/final) 已知向量。仿真覆盖输入固定变化间隔、输出 LFSR 伪随机停顿与长时间阻塞、两队列填满、忙时密钥更新及初始化/密钥扩展/运算中/结果阻塞时复位。

在仓库根目录执行：

```powershell
python projects/system-bench/aes/generate.py
python projects/system-bench/run.py aes sim
python projects/system-bench/aes/negative.py
python projects/system-bench/run.py aes impl
```

本机 Vivado 2020.2 曾在并发和单个 batch 运行时发生工具自身 Tcl 文件读取失败，根因未定；物理实现按顺序启动以降低内存需求，仿真可并发。负控翻转第一块密文期望值的 1 bit，必须得到 `Fatal: AES mismatch block=0` 且无通过标记；XSim 进程退出码 0 不能独立作为通过依据。

本轮成功的实现采用 `python projects/system-bench/aes/direct_impl.py` 在独立短目录直接启动同一 Vivado Tcl；命令、源码快照、资源/时序报告和 DCP 均保留在 `artifacts/aes-direct-181959`。此前 4 次工具初始化失败日志也保留；成功原因不能单独归因于目录、启动包装层或内存变化。

`manifest.json` 固定来源、向量哈希、参与综合的源码与哈希；`latest-sim.json`、`latest-negative.json`、`latest-impl.json` 指向完整证据。综合范围为 7 个模块、2,558 行源码（含注释空行）；没有计入上游软件接口、未使用模块或测试文件。

实现目标为 Artix-7 `xc7a100tfgg676-2`、100 MHz、2 ns 输入/输出延迟的 OOC 实现。它验证 AES 块运算与流接口，不包含 AES-192、认证加密、侧信道验证或真实板卡验证；时序结果也不代表板级签核。
