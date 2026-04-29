# Codex Prompt：ECHO 参量 EQ 全面优化(修 Bug + 提升音质 + 改善交互)

---

## 一、必须先读的文件(不读不要写代码)

请你先实际打开下面这些文件,**逐行**理解现状,然后再开工。回复开头列出"我读了 XX,确认了 XX"清单,**否则你写出来的东西一定是错的**。

- `src/renderer/src/components/EqPlot.jsx`(EQ 主组件,bug 全在这里)
- `src/renderer/src/utils/eqBiquad.js`(Q 钳位)
- `src/renderer/src/constants/eq.js`(预设)
- `src/renderer/src/config/defaultConfig.js`(`DEFAULT_EQ_BANDS`,16 段布局)
- `src/main/audio/eqFloatProcessor.js`(主进程实际跑的 biquad 处理器,RBJ cookbook 实现)
- `src/renderer/src/index.css`(搜 `hi-fi-eq-plot-main-wrapper`、`preamp-vertical-container`、`eq-selected-info-bar`,所有 EQ 样式都在这里)
- `src/renderer/src/App.jsx`(搜 `<EqPlot`,看父组件怎么传 props,`config.eqBands`、`config.useEQ`、`config.preamp`、`activePreset` 状态结构)
- `src/renderer/src/i18n/index.js`(确认 `eqPlot.*` 现有 key,新增 key 不要冲突)

---

## 二、用户反馈的真实 Bug(已定位,请逐条修)

### Bug 1:鼠标移过去 EQ 一片空白,无法做任何调整

**根因(已查实)**:
- `EqPlot.jsx` 第 217 行 `if (!enabled || !bands) return` —— 当 `useEQ === false` 时整个曲线和 16 个控制点都不画,画布除了背景网格啥都没有
- hover 命中半径 `minDist = 20`(px)对 16 段密集分布太小,稍偏一点就识别不到
- 底部信息栏在 `activeNode` 为 null 时显示 `--`,且 filter 类型选择器和 Q 滑条用 `if (activeNode && activeIdx !== null)` 完全隐藏 —— 用户看到的"空白"就是这两个叠加的结果

**必须做的修复**:

1. **EQ 关闭时也要画控制点**:把 `if (!enabled || !bands) return` 拆成:
   - 总开关关时,曲线画成"半透明灰"提示用户是 bypass 状态
   - 控制点照常画(用户应该能在 bypass 状态下预览调整效果,这是任何专业 EQ 的标准行为)
   - 加一行明显的提示文本 "EQ Bypassed — click here to enable"(可点,直接开 EQ)
2. **加大 hover 命中半径并自适应**:
   - 拖拽命中(`handleMouseDown`)半径改为 `Math.max(28, canvas.width / 30)`
   - hover 检测半径改为 `Math.max(32, canvas.width / 28)`
   - 即使没 hover 到精确的点,只要鼠标在画布内,也要找出**最近**的 band 作为"被聚焦"对象(只要距离 < 半径阈值)
3. **底部信息栏永不为空**:
   - 即使没 hover,也默认显示**最近频率轴位置**对应的 band 信息(根据鼠标 X 坐标找最近频段),而不是显示 `--`
   - filter 类型选择器和 Q 滑条**永远显示**,只是值跟随当前激活/最近的 band。完全不要再用 `if (activeNode && activeIdx !== null)` 把整个控件藏起来
4. **加一个"频段选择下拉"**:在信息栏左侧加一个 `<select>`,列出 16 个频段(显示频率,如 `Band 1 – 32Hz`、`Band 2 – 45Hz` ...),用户可以直接选,不用必须 hover 准
5. **画布上的控制点要更显眼**:
   - 默认状态下点的半径从 6 → 8
   - 点中间填色而不是纯白(用 accent 色 + 50% 透明度填充,边框 accent 实色)
   - 启用状态(band.enabled)和禁用状态点要有明显视觉区分(禁用的点画 `×` 或半透明)

### Bug 2:preamp 只能滑动,无法输入数值

**根因(已查实)**:`EqPlot.jsx` 第 380-388 行只有 `<input type="range">`,完全没有数值输入框。底部信息栏的 FREQ / GAIN / Q 也都是只读的 `<b>{value}</b>`。

**必须做的修复**:

1. **Preamp 加数值输入框**:
   - 在现有竖向滑条**旁边或下方**加一个 `<input type="number" min="-20" max="20" step="0.1">`,与滑条**双向绑定**
   - 输入框失焦或回车时校验范围,超出钳位
   - preamp 上下限从 ±12 拓宽到 ±20 dB(满足母带级用户需求,记得同步 `eqFloatProcessor.js` 已经接受任意 dB 不需要改)
2. **每个频段的 FREQ / GAIN / Q 全部改成可编辑**:
   - 信息栏的三个数值改成 `<input type="number">`
   - FREQ:`min=20 max=20000 step=0.5`(Hz)
   - GAIN:`min=-24 max=24 step=0.1`(dB)
   - Q:peaking 用 `min=0.1 max=10 step=0.05`,shelf 用 `min=0.1 max=2 step=0.05`(比之前的 1 上限放宽,见 Bug 3)
   - 输入框样式跟随 UiPanel 风格,失焦立即应用,回车也立即应用,Esc 取消
3. **每个频段加 enable/disable 按钮**:信息栏里加一个开关图标,点击切换当前激活 band 的 `enabled` 字段
4. **每个频段加 Solo / Mute 按钮**:
   - Solo:临时只听这一段(其它段 gain 设为 0,但**不修改保存的状态**,solo 关闭后自动恢复)
   - Mute:把当前段 gain 设为 0
   - 这是专业 EQ(FabFilter Pro-Q、TDR Nova)的标配,对调音很有用

### Bug 3:出来的声音不够好听,不够精细

**根因(已分析)**:
- biquad 直接在采样率上跑,**高频段会"挤压"**(frequency warping near Nyquist)。44.1kHz 采样下,16kHz 高架的实际响应曲线和理想曲线偏差很大,听感就是"糊"和"不清晰"
- shelf 的 Q 上限被钳到 1,**没有 slope(6/12/24 dB/oct)概念**,无法精确控制斜率
- 默认 Q = 1.3 对一般音乐偏窄,听起来"刺",像加了 notch 而不是音乐性 EQ
- 没有输出软限幅(soft clip),preamp 没拉够时叠加多段 boost 容易直接 clip,听起来"破"
- 没有 A/B 对比,用户无法直接对照"开 EQ 前 vs 开 EQ 后"
- 16 段全是固定频率,无法移动到目标位置(虽然现在可以拖,但没有数值输入很难精确定位)

**必须做的优化**(按优先级):

#### 3.1 高频"挤压"修复(最核心,直接解决"糊")

在 `eqFloatProcessor.js` 里加 **2× 过采样模式**(opt-in,默认开启,能耗换音质):

```
processInterleaved 流程改为:
  原始 → 2× 上采样(零填充 + 半带 FIR 抗混叠滤波) → biquad 链 → 2× 下采样(同样半带 FIR) → 输出
```

具体实现:
- 用一个**对称半带 FIR**(31-tap 或 63-tap,系数预先计算好,直接硬编码常量数组),足以抑制 alias 到 -80dB
- 处理在 88.2/96kHz 上跑,Nyquist 提升后 16kHz 高架的曲线就贴合理想曲线
- 提供 `oversample` 配置项:`'off' | '2x' | '4x'`,默认 `'2x'`
- 在 EQ 设置 UI 加这个选项,有"高音质 / 平衡 / 低 CPU"三档

#### 3.2 Shelf Slope 参数

- 在 band 数据结构里给 lowshelf/highshelf 加 `slope` 字段:`6 | 12 | 24`(dB/oct)
- 用**级联 biquad**实现:6 dB/oct = 1 个 1 阶 shelf;12 dB/oct = 1 个 2 阶 biquad shelf(现有);24 dB/oct = 2 个串联 biquad shelf
- 在 UI 里 shelf 类型出现时,Q 滑条切换为 "Slope" 选择器(`6 dB/oct` / `12 dB/oct` / `24 dB/oct`)
- 这是 Pro-Q / Equalizer APO 的标配

#### 3.3 输出软限幅(防止过载听感破)

在 EQ 处理链最后加一个**硬阈 -0.5 dBFS、过渡 1 dB 的 soft-clip**:

```
softClip(x) = tanh(x * k) / k,k 自动根据峰值调整,使 -1 dBFS 以下完全透明,接近 0 dBFS 时柔性压缩
```

或者用更简单的:`x * (1 - x*x/3)` 截断在 ±1。
- 提供配置项 `eqSoftClipEnabled`,默认 `true`
- UI 加一个"Output Safety: Soft Clip / Hard Limit / Off"选项

#### 3.4 默认 Q 调整

把 `defaultConfig.js` 的 `DEFAULT_EQ_BANDS` 默认 Q 从 1.3 改成 **1.0**(更音乐性的宽度,符合 Pro-Q 等专业 EQ 默认值)。

#### 3.5 A/B 对比按钮

- 在 EQ 面板顶部加 `A | B | A=B` 三个按钮
- A 和 B 是两套独立的 `(eqBands, preamp)` 状态
- 点击切换瞬间应用,用户能直接对比两套调音
- A=B 把 A 的设置复制到 B(或反之,用 modifier key)

#### 3.6 频段拖动时显示"邻段交互曲线"(高级,可选)

拖动一个 band 时,**额外用细线画出"如果只有这一段的曲线"** + 其它段的曲线,视觉上让用户看到自己的修改对最终曲线的贡献,避免"调一段影响一片"的感觉。

#### 3.7 EQ 预设升级

`constants/eq.js` 里的预设质量平庸。重做这些预设(基于 Harman 曲线和现代音频学),并新增几个真正"好听"的:

- `Reference (Harman 2018)`:基于哈曼参考曲线
- `Warm`:轻抬 200-500Hz(温暖)、轻收 3-5kHz(去刺)
- `Bright`:轻抬 8-12kHz 空气感、轻收 200-300Hz 浊
- `Dialogue / Podcast`:600Hz–3kHz 抬,两端收
- `Late Night`(等响度低音量补偿):大幅抬两端,模拟低音量等响度
- `V-Shape`:经典消费向 V 形

旧预设保留,标注为 `Legacy`。

---

## 三、UI / 视觉重构(现有的 EqPlot UI 太"业余",必须改)

参考 **FabFilter Pro-Q 4** 和 **TDR Nova** 的视觉语言:

1. **画布上常驻显示频段编号**:每个 band 点旁边永久显示小数字 `1` 到 `16`,无需 hover
2. **拖动时显示十字辅助线**:水平线显示当前 gain,垂直线显示当前 freq,两端有数值标签
3. **频率刻度更密**:除了现在的 20/50/100/200/500/1k/2k/5k/10k/20k,在 hover 时动态显示当前鼠标频率(每 10Hz 精度)
4. **dB 刻度同上**:hover 时显示当前鼠标 dB 值
5. **曲线启用 anti-aliasing**:`ctx.imageSmoothingEnabled = true`,曲线在视网膜屏更清晰
6. **频段操作右键菜单**:右键 band 弹出菜单,包含 Reset / Solo / Mute / Delete / Set Type → ...
7. **键盘操作**:focus EQ 后,方向键微调当前 band(↑↓ gain ±0.1,←→ freq ×1.05/0.95),Shift+方向键 ×10,Delete = mute
8. **画布最小高度从 380px 改成 max(380px, 50vh)**,响应式更友好

---

## 四、必须遵守的工程约束

- 不引入新依赖(soft clip / 上采样 FIR 都自己写,系数硬编码)
- 不改变现有 `config.eqBands` 数据结构的现有字段(只添加新字段,如 `slope`),保证旧用户配置不丢
- `configRevision` +1,在 App 加载时跑 migration 兼容旧 16 段配置
- 主进程 `eqFloatProcessor.js` 是性能关键路径,**不要**用 try/catch、不要在内层循环创建对象,**不要**用 Array.forEach(用 for 循环)
- 上采样 FIR 用 `Float32Array`,卷积循环手写
- 所有用户可见字符串走 i18n,key 用 `eqPlot.*` 命名空间
- 提交前 `npm run lint` 和 `npm run format` 必须通过
- 用 `npm run test:unit` 跑现有测试,如果有 EQ 相关测试别破坏

---

## 五、性能预算(必须实测)

- 2× 过采样开启时,主进程 EQ 处理 CPU 占用增加 ≤ 1.5×(从 3% 到 4.5% 是可接受的,不能到 8%)
- 4× 过采样开启时 ≤ 3×
- UI 拖动 EQ 点时,曲线重绘 fps ≥ 60(用 Performance.now() 测)
- 内存:不能因为 A/B 状态加倍而泄漏,A/B 共享底层数据结构

---

## 六、验收标准(逐条勾,自测后提交)

- [ ] 关闭 useEQ 后,EQ 画布仍能看到 16 个控制点(半透明)和当前曲线(灰色)
- [ ] 鼠标在画布任何位置移动,底部信息栏永远显示**最近**band 的信息,不再是 `--`
- [ ] filter 类型下拉、Q 滑条、enable 开关、Solo、Mute 永远可见
- [ ] Preamp 既能拖,也能在数值框直接输入(回车或失焦生效)
- [ ] FREQ / GAIN / Q 三个数值都能直接键入数字
- [ ] 选段下拉能跳到任意 band
- [ ] Shelf 类型下,Q 滑条变成 Slope 选择(6/12/24 dB/oct)
- [ ] 2× 过采样开启 vs 关闭,16kHz 高架 +6dB 时,频谱仪上能看到差异(关闭时高频曲线偏离理想响应,开启时贴合)
- [ ] A/B 按钮切换瞬间响应,无爆音
- [ ] 推 +12dB 多段 boost,输出不再硬 clip(听感不破)
- [ ] 中 / 英 / 日三语字符串无遗漏
- [ ] 旧用户的 `eqBands` 配置加载后不报错,迁移后所有 band 完整
- [ ] CPU 占用在性能预算内
- [ ] 60fps 拖动无卡顿

---

## 七、不要做的事(避免 scope creep)

- 不做线性相位 EQ(FFT 卷积复杂度过高,留待后续)
- 不做动态 EQ(频段随信号自动调整)
- 不做 mid/side 分离 EQ
- 不改 EQ 段数(保持 16 段)
- 不引入新的图表库(D3、recharts 等),继续用原生 canvas 2D
- 不做 VST 形式的 EQ 插件接口(已有 VST host,EQ 是内建的)

---

## 八、交付清单

请最终回复给出:

1. 修改文件列表(完整路径)
2. `EqPlot.jsx` 的完整重写版(用户最直观感受到的就是这个)
3. `eqFloatProcessor.js` 的关键变更 diff(过采样 + soft clip)
4. `defaultConfig.js` 的迁移逻辑变更
5. 新预设的完整代码
6. 自测报告(每条验收标准的实测结果)
7. 性能实测数据(过采样开启前后的 CPU 占用对比)

---

请先列"我读了 XX 文件,确认了 XX 现状"清单,再写代码。**不要凭空假设任何 API 或数据形状**。

开始干活。
