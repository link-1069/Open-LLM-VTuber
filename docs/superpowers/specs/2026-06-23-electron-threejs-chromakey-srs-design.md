# Electron 主窗口 Three.js 绿幕抠像设计

日期：2026-06-23

## 背景

当前 Electron 主窗口已经能读取保存的 SRS WHEP 地址，用 `srs.sdk.js` 拉流，并把远端 MediaStream 绑定到隐藏的 `<video>` 元素。主窗口现在用手写 WebGL passthrough shader 把视频绘制到透明窗口中的 `<canvas>`，还保留了字幕层和后端 WebSocket 重连逻辑。

参考项目 `F:\下载\threejs_chromakey_video_material-main\threejs_chromakey_video_material-main` 提供了一个基于 Three.js 的 `ShaderMaterial`，核心是把视频做成 `THREE.VideoTexture`，再用 `keyColor`、`similarity`、`smoothness`、`spill` 四个参数执行绿幕抠像。

## 目标

把 Electron 主窗口的数字人视频渲染改为 Three.js 管线：

- 继续使用当前 SRS WHEP 流作为视频源。
- 使用参考项目的 chroma key shader 逻辑移除绿色背景。
- 保留透明无边框置顶窗口、字幕、拖拽窗口、SRS 重连、后端 WebSocket 重连等现有行为。
- 将 Three.js 作为 Electron 子项目的显式依赖，保证本地运行和打包边界清晰。

## 非目标

- 不改 Python 后端、Open-LLM-VTuber 主服务或对话链路。
- 不改 SRS WHEP 协议、SRS SDK 的信令流程或设置页连接测试逻辑。
- 不添加复杂 UI 调参面板；本次只保留代码常量，便于后续根据实际绿幕颜色微调。
- 不引入 Parcel、TypeScript、dat.gui、rxjs、OrbitControls 或 Stats；只复制必要 shader 思路。

## 推荐方案

采用拆分式方案：

- `renderer.js` 继续作为主窗口编排入口，负责读取配置、启动 WHEP 流、连接后端 WebSocket、显示字幕。
- 新增 Three.js 渲染模块，封装场景、相机、渲染器、视频纹理、抠像材质、窗口 resize 和动画循环。
- 如有必要，新增小型 SRS 流管理模块，把现有 `startStream()`、重试定时器、SDK 生命周期从 `renderer.js` 中分离出来。

这样主窗口仍然是一个页面，但 SRS、Three.js、字幕/后端消息各自有清晰职责。

## 组件设计

### 主窗口 HTML

`electron/renderer/main.html` 保留隐藏 `<video id="video">` 作为音视频播放源，保留 `<div id="subtitle">`。现有 `<canvas id="canvas">` 可以替换为 Three.js 挂载容器或继续作为 Three.js renderer canvas 的挂载目标。

窗口 CSS 继续保持：

- `html, body` 透明背景。
- 窗口主体可拖拽。
- 字幕层不可拖拽。
- 视频元素隐藏但保持播放能力。

### Three.js 渲染模块

Three.js 模块负责：

- 创建 `THREE.WebGLRenderer({ alpha: true, antialias: true })`。
- 创建透明 scene 和正交相机。
- 使用隐藏视频元素创建 `THREE.VideoTexture`。
- 创建一个铺满主窗口的 `PlaneGeometry`。
- 使用复制自参考项目的 fragment shader 进行 chroma key：
  - `RGBtoUV`
  - `ProcessChromaKey`
  - `keyColor`
  - `similarity`
  - `smoothness`
  - `spill`
- 在 `requestAnimationFrame` 中渲染。
- 在 resize 时更新 renderer 尺寸和相机投影。
- 提供 `dispose()`，释放 renderer、texture、geometry、material，避免窗口重启时泄漏。

默认参数：

- `keyColor`: `0x19ae31`
- `similarity`: `0.159`
- `smoothness`: `0.082`
- `spill`: `0.214`

这些参数来自参考项目示例。实际 SRS 流如果绿幕色偏不同，后续只调整常量。

### SRS 流模块

SRS 模块负责：

- 检查 `SrsRtcWhipWhepAsync` 是否存在。
- 创建 SDK 实例。
- 将 `sdk.stream` 绑定到隐藏视频元素。
- 调用 `sdk.play(whepUrl)`。
- 播放成功后调用 `video.play()`。
- 失败时沿用当前 5 秒重试。
- 切换 URL 或重启时关闭旧 SDK。

该模块不需要知道 Three.js；Three.js 只消费同一个视频元素。

### Renderer 编排

`renderer.js` 保留高层流程：

1. 初始化字幕工具。
2. 初始化 Three.js stage，并传入隐藏视频元素。
3. 读取 Electron 配置和后端 WebSocket 地址。
4. 如果配置里有 WHEP URL，则启动 SRS 流。
5. 建立 WebSocket，继续处理字幕和后端事件。
6. WebSocket 或 SRS 流断开时按现有策略重连。

## 数据流

```text
SRS WHEP URL
  -> SrsRtcWhipWhepAsync.play()
  -> sdk.stream
  -> hidden <video>
  -> THREE.VideoTexture
  -> ChromaKey ShaderMaterial
  -> transparent Electron BrowserWindow
```

字幕数据仍然走原来的后端 WebSocket：

```text
Python backend WebSocket
  -> renderer.js message handler
  -> #subtitle
```

## 错误处理

- Three.js 初始化失败：显示字幕错误，并在 console 输出详细错误。
- WebGL 不可用：显示字幕错误，避免空白无提示。
- SRS SDK 缺失：沿用当前错误提示和重试策略。
- WHEP 播放失败：关闭当前 SDK 并 5 秒后重试。
- 视频未有当前帧：Three.js 循环继续运行，等视频可用后自动显示。

## 依赖和打包

在 `electron/package.json` 中新增运行依赖：

```json
"dependencies": {
  "three": "^0.142.0"
}
```

版本优先与参考项目一致，减少 shader/texture API 差异。Electron 打包配置目前包含 `**/*` 并排除顶层 `node_modules`，实现时需要确认 `electron-builder` 是否会正确收集 Electron 子项目的生产依赖。

## 测试计划

1. 单元级检查：
   - 抽出的 chroma key 默认参数存在且可导出。
   - Three.js stage 能在 mock DOM 条件下创建和 dispose，或至少通过静态 smoke test 覆盖模块加载。

2. Electron 真实窗口测试：
   - 使用 Playwright Electron 启动主窗口。
   - 写入真实 WHEP URL：`http://127.0.0.1:1985/rtc/v1/whep/?app=live&stream=1782211996791800259`。
   - 验证主窗口加载后没有渲染初始化错误。
   - 验证页面包含 Three.js renderer canvas。
   - 如 SRS 流正在推送，验证视频元素进入播放状态，并通过截图/像素采样确认主窗口不是纯黑或纯透明。

3. 回归检查：
   - 设置页连接测试仍然通过。
   - WHEP URL 保存后主窗口仍自动打开。
   - 字幕消息仍能显示和自动隐藏。

## 成功标准

- Electron 主窗口使用 Three.js 渲染 SRS 视频。
- 绿色背景通过 shader 变透明，人物主体保留。
- 原有 SRS 拉流、重连、字幕和透明窗口行为不退化。
- 本地测试命令和 Playwright Electron 真实窗口验证通过。

## 自检

- 没有未定内容。
- 范围限定在 Electron 主窗口渲染和必要依赖。
- 不要求修改后端或 SRS 服务器。
- Three.js、SRS、字幕职责边界明确。
