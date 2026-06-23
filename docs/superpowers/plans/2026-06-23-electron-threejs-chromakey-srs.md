# Electron Three.js Chromakey SRS Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Electron main window's passthrough WebGL renderer with a Three.js video-texture stage using chroma key shader logic for the SRS WHEP stream.

**Architecture:** Keep `renderer.js` as the orchestration layer. Add focused renderer modules for chroma key material, Three.js stage lifecycle, and SRS stream lifecycle. The hidden `<video>` remains the single bridge between SRS WebRTC playback and the Three.js `VideoTexture`.

**Tech Stack:** Electron 31, plain browser scripts, Node `node:test`, SRS WHEP SDK, Three.js `0.142.x`, Playwright Electron for real-window verification.

---

### Task 1: Chroma Key Material Module

**Files:**
- Create: `electron/renderer/chroma_key_material.js`
- Create: `electron/renderer/chroma_key_material.test.js`
- Modify: `electron/package.json`
- Modify: `electron/package-lock.json`

- [ ] **Step 1: Write the failing test**

Create `electron/renderer/chroma_key_material.test.js` with Node tests that require `three`, require `./chroma_key_material`, verify exported default parameters, verify shader text contains `RGBtoUV` and `ProcessChromaKey`, and create a material with a real `THREE.ShaderMaterial`.

- [ ] **Step 2: Run the test to verify RED**

Run: `node --test .\renderer\chroma_key_material.test.js`

Expected before implementation: FAIL because `three` or `./chroma_key_material` is missing.

- [ ] **Step 3: Install dependency**

Run: `npm install three@^0.142.0 --save`

Expected: `electron/package.json` has a `dependencies.three` entry and `electron/package-lock.json` records `node_modules/three`.

- [ ] **Step 4: Implement material module**

Implement a UMD-style plain script exporting:

```javascript
DEFAULT_CHROMA_KEY
VERTEX_SHADER
FRAGMENT_SHADER
createChromaKeyMaterial(THREE, video, options)
```

`createChromaKeyMaterial` must create `THREE.VideoTexture(video)`, build shader uniforms, return `THREE.ShaderMaterial`, and store the texture on `material.userData.videoTexture`.

- [ ] **Step 5: Run GREEN**

Run: `node --test .\renderer\chroma_key_material.test.js`

Expected: PASS.

### Task 2: SRS Stream Controller Module

**Files:**
- Create: `electron/renderer/srs_stream.js`
- Create: `electron/renderer/srs_stream.test.js`
- Modify: `electron/renderer/renderer.js`

- [ ] **Step 1: Write the failing test**

Create tests for:

- missing SDK constructor reports `SRS SDK is not available` and schedules retry
- successful `start(url)` binds `sdk.stream` to `video.srcObject`, calls `sdk.play(url)`, then calls `video.play()`
- failed `sdk.play()` closes the failed SDK and schedules retry

- [ ] **Step 2: Run RED**

Run: `node --test .\renderer\srs_stream.test.js`

Expected before implementation: FAIL because `./srs_stream` is missing.

- [ ] **Step 3: Implement controller**

Implement `createSrsStreamController(options)` with `start(whepUrl, forceRestart = false)`, `close()`, retry timer cleanup, stale attempt guard, and SDK cleanup.

- [ ] **Step 4: Run GREEN**

Run: `node --test .\renderer\srs_stream.test.js`

Expected: PASS.

### Task 3: Three.js Stage Module

**Files:**
- Create: `electron/renderer/three_stage.js`
- Create: `electron/renderer/three_stage.test.js`
- Modify: `electron/renderer/main.html`
- Modify: `electron/renderer/renderer.js`

- [ ] **Step 1: Write the failing test**

Create tests for:

- stage appends a renderer canvas to the mount element
- stage calls `renderer.setClearColor(0x000000, 0)` and initial `setSize`
- stage creates a mesh using chroma key material
- `dispose()` removes resize listener, cancels animation frame, removes canvas, and disposes geometry/material/renderer

- [ ] **Step 2: Run RED**

Run: `node --test .\renderer\three_stage.test.js`

Expected before implementation: FAIL because `./three_stage` is missing.

- [ ] **Step 3: Implement stage**

Implement `createThreeVideoStage(options)` with explicit dependency injection for `THREE`, `video`, `mount`, `windowRef`, `createMaterial`, and `showError`.

- [ ] **Step 4: Run GREEN**

Run: `node --test .\renderer\three_stage.test.js`

Expected: PASS.

### Task 4: Main Window Integration

**Files:**
- Modify: `electron/renderer/main.html`
- Modify: `electron/renderer/renderer.js`

- [ ] **Step 1: Add script order**

Load scripts in this order:

```html
<script src="../node_modules/three/build/three.min.js"></script>
<script src="srs.sdk.js"></script>
<script src="chroma_key_material.js"></script>
<script src="three_stage.js"></script>
<script src="srs_stream.js"></script>
<script src="renderer.js"></script>
```

- [ ] **Step 2: Replace canvas host**

Use a `<div id="stage"></div>` host for the Three.js renderer and keep `<video id="video" autoplay playsinline></video>` plus `<div id="subtitle"></div>`.

- [ ] **Step 3: Update `renderer.js` orchestration**

Initialize:

```javascript
const stage = createThreeVideoStage({
  THREE: window.THREE,
  video,
  mount: stageEl,
  showError: showSubtitle,
})

const streamController = createSrsStreamController({
  video,
  showStatus: showSubtitle,
  getSdkCtor: () => window.SrsRtcWhipWhepAsync,
})
```

Then replace direct `startStream(config.whep_url)` calls with `streamController.start(config.whep_url)`.

- [ ] **Step 4: Run integration tests**

Run:

```powershell
node --test .\renderer\chroma_key_material.test.js .\renderer\srs_stream.test.js .\renderer\three_stage.test.js .\renderer\setup_probe.test.js
```

Expected: PASS.

### Task 5: Verification

**Files:**
- Read-only verification unless fixes are required.

- [ ] **Step 1: Package metadata sanity**

Run: `npm ls three`

Expected: installed `three@0.142.x`.

- [ ] **Step 2: Electron start smoke**

Run: `npm start` only through a bounded automation script so the process is closed after window verification.

Expected: Electron main window loads without renderer initialization errors.

- [ ] **Step 3: Playwright Electron real-window test**

Run a Playwright Electron script that writes a config containing:

```text
http://127.0.0.1:1985/rtc/v1/whep/?app=live&stream=1782211996791800259
```

Then verify:

- `window.THREE` exists
- `#stage canvas` exists
- `window.__openLlmVtuberStageReady === true`
- `window.__openLlmVtuberStreamControllerReady === true`
- no fatal renderer errors

- [ ] **Step 4: Final review**

Review git diff against the design spec and remove any unnecessary changes.

## Self-Review

- Spec coverage: dependency, material, stage, stream controller, integration, and Electron verification are covered.
- Placeholder scan: no unfilled task text remains.
- Type consistency: module names and exported functions are consistent across tasks.
