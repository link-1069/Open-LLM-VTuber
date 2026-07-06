# Open-LLM-VTuber

Open-LLM-VTuber combines a browser-facing interaction page with a real-time digital-human renderer. This glossary names the user-visible surfaces so design discussions do not confuse entry flow with rendering flow.

## Language

**入口页**:
The first page shown to the user before the digital human begins rendering or listening. In this setup it is the externally hosted `h5.html` page at `http://localhost:8500/static/h5.html`.
_Avoid_: 默认页, 资源网页

**绿幕数字人**:
The active digital-human experience that plays a WHEP video stream and removes the green background before showing the avatar to the user.
_Avoid_: 数字人窗口, 绿色口型
