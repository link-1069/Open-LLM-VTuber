# Design: Replace Live2D with SRS WHEP + Electron Desktop Pet

**Date:** 2026-06-23  
**Status:** Approved

## Goal

Replace the Live2D avatar rendering in Open-LLM-VTuber with a video stream from a separate digital-human inference service (SRS via WHEP protocol). Package the result as a Windows desktop pet: a transparent, always-on-top, draggable Electron window that the user launches with a single double-click.

## Decisions Captured

| Question | Decision |
|---|---|
| Desktop host | Electron (Chromium, full WebRTC/WebGL support) |
| SRS WHEP URL storage | Electron-local `userData/config.json`; Python backend never sees it |
| Audio delivery | SRS WHEP stream only; WebSocket `audio` messages deprecated |
| Expression / emotion tags | Removed; inference model owns facial expression entirely |
| Python spawn | Electron main process spawns `uv run run_server.py` as child |

## Architecture

```
User double-clicks .exe
        │
        ▼
Electron main.js
  ├─ spawn: uv run run_server.py (cwd = project root)
  │       polls stdout for "Application startup complete"
  ├─ read userData/config.json
  │     ├─ whep_url present  ──→ open main window
  │     └─ missing (first run) → open setup window first
  └─ IPC bridge (contextBridge) exposes config + ws-url to renderer

Setup window (setup.html)
  └─ text input for WHEP URL → validate (attempt WebRTC offer) → save → close → open main window

Main window (main.html)  [transparent, frameless, alwaysOnTop]
  ├─ WebSocket  ws://localhost:PORT/client-ws
  │     ├─ recv set-conf         → update conf_name / conf_uid
  │     ├─ recv display-text     → render subtitle overlay
  │     ├─ recv full-text        → update chat bubble
  │     └─ send text-input / mic-audio-end / interrupt-signal / … (unchanged)
  ├─ SrsRtcWhipWhepAsync.play(whep_url) → sdk.stream → hidden <video>
  └─ WebGL <canvas> (covers window)
        └─ rAF loop: texImage2D(video) → drawArrays with passthrough shader
           [TODO: replace vert/frag with chroma-key shader]
```

## Python Backend Changes

### Files to delete
- `src/open_llm_vtuber/live2d_model.py`
- `model_dict.json`

### Files to modify

**`config_manager/character.py`**
- Remove `live2d_model_name` field.

**`service_context.py`**
- Remove `self.live2d_model: Live2dModel` attribute.
- Remove `init_live2d()` method and its call in `load_from_config()`.
- Remove `live2d_model=` from `load_cache()` signature and `AgentFactory.create_agent()` call.
- In `construct_system_prompt()`: remove the `live2d_expression_prompt` branch entirely.
- In `handle_config_switch()`: change `set-model-and-conf` → `set-conf`, remove `model_info` key.

**`agent/agent_factory.py`**
- Remove `live2d_model` parameter from `create_agent()` signature and all downstream instantiation calls.

**`agent/agents/basic_memory_agent.py`**
- Remove `live2d_model` constructor parameter and `self._live2d_model`.
- Remove `@actions_extractor(self._live2d_model)` decorator; the agent now yields plain `SentenceOutput` with `actions=Actions()` (empty).

**`agent/agents/letta_agent.py`**
- Same as above: remove `live2d_model` parameter and `actions_extractor` usage.

**`conversations/tts_manager.py`**
- Remove `live2d_model: Live2dModel` parameter from `speak()` and `_process_tts()`.
- Replace `prepare_audio_payload(...)` call with a lightweight `display-text` payload (see Protocol section).
- TTS file generation (`_generate_audio`) is **kept**: inference model still needs the audio file.  
  File is deleted via `tts_engine.remove_file()` as before.

**`conversations/conversation_utils.py`**
- Remove `live2d_model` from `process_agent_output()` / `handle_sentence_output()` signatures.
- Remove `Actions` extraction; pass `actions=None` through.

**`websocket_handler.py`**
- Change outgoing `set-model-and-conf` message type to `set-conf` (remove `model_info` key).

**`server.py`**
- Remove `/live2d-models` static file mount.

**`routes.py`**
- Remove `GET /live2d-models/info` endpoint.

**`config_templates/conf.default.yaml` and `conf.ZH.default.yaml`**
- Remove `live2d_model_name` key under `character_config`.

### No change
- LLM / ASR / TTS / VAD / MCP pipelines.
- All other WebSocket message types.
- `chat_history_manager`, `service_context.close()`, MCP components.

## WebSocket Protocol Changes

### `set-model-and-conf` → `set-conf`

```json
// Before
{ "type": "set-model-and-conf", "model_info": {...}, "conf_name": "...", "conf_uid": "..." }

// After
{ "type": "set-conf", "conf_name": "...", "conf_uid": "..." }
```

### `audio` → `display-text`

```json
// Before
{
  "type": "audio",
  "audio": "<base64 wav>",
  "volumes": [...],
  "slice_length": 20,
  "display_text": { "text": "...", "name": "AI", "avatar": "..." },
  "actions": { "expressions": [...] }
}

// After
{
  "type": "display-text",
  "display_text": { "text": "...", "name": "AI", "avatar": "..." }
}
```

Timing: `display-text` is sent when TTS audio generation completes (maintaining the existing `TTSTaskManager` sequence ordering). No change to ordering logic.

## Electron App

### Directory layout

```
electron/                       ← new directory in project root
├── package.json                ← electron, electron-builder
├── main.js                     ← main process
├── preload.js                  ← contextBridge IPC
└── renderer/
    ├── setup.html              ← first-run URL input window
    ├── setup.js
    ├── main.html               ← desktop pet window
    ├── renderer.js             ← WebSocket + SRS + WebGL
    ├── srs.sdk.js              ← copied from ossrs/srs trunk/research/players/
    └── style.css
```

### main.js responsibilities

```javascript
// 1. Spawn Python server
const server = spawn('uv', ['run', 'run_server.py'], { cwd: projectRoot, shell: true })
// Wait for "Application startup complete" in stdout before opening window

// 2. Read / write userData/config.json
//    { whep_url: string, last_updated: string }

// 3. Window: setup (800×200, normal) OR main (full-screen-ish, transparent)
//    Main window options:
//    { transparent: true, frame: false, alwaysOnTop: true,
//      hasShadow: false, resizable: true, skipTaskbar: false }

// 4. Drag: renderer uses -webkit-app-region: drag on root container

// 5. On before-quit: server.kill()
```

### preload.js (contextBridge)

```javascript
contextBridge.exposeInMainWorld('electronAPI', {
  getConfig:   () => ipcRenderer.invoke('get-config'),
  saveConfig:  (cfg) => ipcRenderer.invoke('save-config', cfg),
  getWsUrl:    () => ipcRenderer.invoke('get-ws-url'),   // ws://localhost:PORT/client-ws
})
```

### renderer.js responsibilities

1. Read `whep_url` via `electronAPI.getConfig()`.
2. Connect WebSocket → handle `set-conf`, `display-text`, `full-text`, `error`.
3. Instantiate `SrsRtcWhipWhepAsync`, call `sdk.play(whep_url)`, assign `sdk.stream` to hidden `<video>`.
4. Start WebGL render loop.
5. Expose microphone → send `mic-audio-data` / `mic-audio-end` frames (existing protocol).

### WebGL placeholder shader

```glsl
// vertex.glsl (passthrough)
attribute vec2 aPos;
varying vec2 vUV;
void main() {
  vUV = aPos * 0.5 + 0.5;
  gl_Position = vec4(aPos, 0.0, 1.0);
}

// fragment.glsl (passthrough — chroma key TODO)
precision mediump float;
uniform sampler2D uVideo;
varying vec2 vUV;
void main() {
  vec4 color = texture2D(uVideo, vec2(vUV.x, 1.0 - vUV.y));
  // TODO: discard or set alpha=0 for green pixels
  // float greenness = color.g - max(color.r, color.b);
  // if (greenness > 0.3) discard;
  gl_FragColor = color;
}
```

rAF loop: `gl.texImage2D(GL_TEXTURE_2D, 0, GL_RGBA, GL_RGBA, GL_UNSIGNED_BYTE, videoElement)` every frame.

### Setup window flow

1. Display text field pre-filled with `http://localhost:1985/rtc/v1/whep/?app=live&stream=avatar`.
2. "连接测试" button: attempt `new SrsRtcWhipWhepAsync().play(url)` then immediately close → shows ✓ or error.
3. "确认" button: save to `userData/config.json`, close setup window, open main window.
4. Main window reads cached URL on all subsequent launches — setup window never appears again unless user resets.

## Out of Scope

- How TTS audio files are delivered to the digital-human inference service (separate project).
- Chroma-key shader implementation (placeholder only per spec).
- Python environment bundling in Electron distributable (future iteration).
- macOS / Linux desktop pet behavior (Windows only for now).

## File Summary

| Action | Path |
|---|---|
| Delete | `src/open_llm_vtuber/live2d_model.py` |
| Delete | `model_dict.json` |
| Modify | `src/open_llm_vtuber/config_manager/character.py` |
| Modify | `src/open_llm_vtuber/service_context.py` |
| Modify | `src/open_llm_vtuber/agent/agent_factory.py` |
| Modify | `src/open_llm_vtuber/agent/agents/basic_memory_agent.py` |
| Modify | `src/open_llm_vtuber/agent/agents/letta_agent.py` |
| Modify | `src/open_llm_vtuber/conversations/tts_manager.py` |
| Modify | `src/open_llm_vtuber/conversations/conversation_utils.py` |
| Modify | `src/open_llm_vtuber/websocket_handler.py` |
| Modify | `src/open_llm_vtuber/server.py` |
| Modify | `src/open_llm_vtuber/routes.py` |
| Modify | `config_templates/conf.default.yaml` |
| Modify | `config_templates/conf.ZH.default.yaml` |
| Create | `electron/` (entire directory) |
