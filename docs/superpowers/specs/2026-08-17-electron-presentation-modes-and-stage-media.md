# Electron 双呈现模式与全屏舞台

日期：2026-08-17
状态：已确认

## Problem Statement

当前 Electron 主展示窗口只提供桌面宠物形态。用户无法在不离开应用的情况下切换到覆盖当前显示器的全屏舞台，也无法为全屏展示设置透明背景或自定义本地背景媒体。现有窗口边界是唯一的窗口状态；如果直接增加全屏切换，全屏边界会污染桌宠位置和尺寸。人物编辑也缺少独立宽高控制，桌宠无边框窗口的尺寸入口不易发现。

用户需要通过右键完成呈现模式切换、舞台背景管理和人物构图调整，并要求模式、背景、人物布局和桌宠边界在重启后可靠恢复。全屏舞台必须无边框、覆盖任务栏、高层级置顶且不穿透鼠标，同时保留清晰的退出、错误恢复和多显示器行为。

## Solution

为主展示窗口增加“桌面宠物模式”和“全屏舞台模式”两种持久化呈现模式。桌面宠物保留可拖动、可缩放窗口，并提供右键进入的可视化宽高编辑器；全屏舞台覆盖桌宠当前所在显示器的完整边界，使用透明或本地媒体作为舞台背景。人物默认保持源比例，编辑时允许用户独立拉伸宽度和高度。

两种模式共用原生右键菜单。菜单提供模式切换、舞台背景管理、桌宠窗口编辑、人物布局编辑、重新检测连接和退出应用。舞台背景支持引用原路径的 PNG、JPG/JPEG、WebP、BMP、GIF 和 MP4；所有媒体采用居中 `cover`，MP4 静音循环。舞台人物使用相对坐标以及独立的相对宽高缩放，支持带八向控制点的拖动、拉伸与滚轮等比缩放。

离散设置以事务方式立即保存；普通桌宠拖动在边界停止变化 3 秒后保存，而可视化桌宠编辑仅在点击“保存”时持久化，“取消”恢复进入编辑前的窗口。保存失败、媒体失效、显示器断开、连接中断和退出前补存都有明确的回退行为。桌面宠物和全屏舞台都不再显示对话字幕。

## User Stories

1. As a desktop companion user, I want to switch between desktop pet mode and fullscreen stage mode from the right-click menu, so that I can choose the presentation that fits my current activity.
2. As a desktop companion user, I want the selected presentation mode restored after restart, so that I do not have to configure the window every time.
3. As an existing user, I want an old configuration to continue opening in desktop pet mode, so that an upgrade never surprises me with a topmost fullscreen window.
4. As a desktop pet user, I want the pet window to remain transparent, borderless, movable, and resizable, so that existing desktop behavior is preserved.
5. As a desktop pet user, I want the pet window to use high-level always-on-top behavior, so that it remains visible above other applications.
6. As a fullscreen stage user, I want the stage to cover the complete display containing the desktop pet, including the taskbar, so that the result is a true stage presentation.
7. As a fullscreen stage user, I want the stage to be borderless and high-level always-on-top, so that no normal application chrome or window obscures it.
8. As a fullscreen stage user, I want the stage to intercept mouse input even when visually transparent, so that right-click controls are available anywhere on the screen.
9. As a fullscreen stage user, I want ordinary left-clicks, left drags, and `Esc` to do nothing, so that the stage cannot be changed accidentally.
10. As a desktop pet user, I want my pre-fullscreen window position and size restored when I leave fullscreen, so that stage mode does not destroy my desktop layout.
11. As a multi-monitor user, I want fullscreen to use the display where the desktop pet currently resides, so that the target screen follows my placement intent.
12. As a multi-monitor user, I want to move the stage by returning to desktop pet mode and moving the pet, so that there is only one target-display rule to understand.
13. As a multi-monitor user, I want fullscreen to move to the primary display if its current display disconnects, so that the stage remains visible.
14. As a multi-monitor user, I want an off-screen desktop pet restored into the primary display's visible area after a display disconnects, so that the pet cannot become unreachable.
15. As a user, I want the existing hidden window-control panel available only in desktop pet mode, so that fullscreen dimensions cannot be corrupted.
16. As a user, I want to select transparent stage background from the right-click menu, so that only the keyed digital human is visible over the desktop.
17. As a user, I want to select a local PNG, JPG/JPEG, WebP, BMP, GIF, or MP4 file, so that I can customize the fullscreen stage with my own media.
18. As a user, I want the application to reference the original media path instead of copying the file, so that there is no duplicate managed asset.
19. As a user, I want selecting a file while the stage background is transparent to update only the selected-media record, so that transparency remains active until I explicitly enable the media.
20. As a user, I want selecting a new file while media background is active to replace the displayed media after validation, so that updating the stage takes one action.
21. As a user, I want switching to transparent background to retain the selected media path, so that I can switch back without reopening the file picker.
22. As a user, I want to clear the selected media path through a confirmed menu action, so that stale or sensitive paths can be removed from configuration.
23. As a user, I want a newly selected media file decoded before it is committed, so that a corrupt or disguised file cannot replace a working background.
24. As a user, I want an explicit modal error when my active file-selection action fails, so that I know why the background was not changed.
25. As a user, I want a missing saved media file to fall back to transparent without a startup modal, so that unavailable removable or network storage does not interrupt me.
26. As a user, I want an unavailable selected media item to remain checked, show its filename and an unavailable marker, and be disabled, so that the intended state remains understandable.
27. As a user, I want a missing media background to restore automatically when the file returns, so that temporary storage outages require no reconfiguration.
28. As a user, I want an active background file that is updated in place to hot-reload after successful decoding, so that re-exporting the asset updates the stage.
29. As a user, I want background file availability and modification checked every 3 seconds only while fullscreen media is relevant, so that restoration is timely without permanent idle polling.
30. As a stage user, I want every image, GIF, and MP4 to preserve aspect ratio and use centered `cover`, so that the screen is filled without distortion.
31. As a stage user, I want MP4 backgrounds to autoplay silently, loop, and hide player controls, so that they behave as backgrounds rather than foreground media players.
32. As a desktop pet user, I want background media stopped and rendering resources released outside fullscreen, so that hidden stage media does not consume CPU or GPU.
33. As a stage user, I want media playback to restart from the beginning whenever fullscreen or a temporary preview starts, so that each presentation has predictable playback.
34. As a stage user, I want the digital human to preserve source aspect ratio, fit screen height, remain horizontally centered, and sit at the bottom by default, so that the initial composition starts undistorted.
35. As a stage user, I want to open a visual person-layout editor from the right-click menu, so that I can adjust composition without entering numeric coordinates.
36. As a stage user, I want a visible rectangular edit frame with eight resize handles that can be dragged, stretched independently, or scaled with the mouse wheel, so that I can control width and height directly.
37. As a stage user, I want wheel scaling to keep the edit-frame center fixed, so that resizing is stable and predictable.
38. As a stage user, I want the person frame center constrained to the display while allowing partial off-screen placement, so that cropped compositions are possible without losing the person completely.
39. As a stage user, I want positive finite width and height scaling without a product-level upper limit, so that I can create extreme or intentionally distorted compositions.
40. As a multi-monitor user, I want one relative person layout shared across display resolutions, so that the composition remains similar without per-display configuration.
41. As a person-layout editor, I want only explicit Save to persist changes and Cancel to restore the prior layout, so that experimentation is reversible.
42. As a person-layout editor, I want `Esc` and the right-click menu disabled during editing, so that Save and Cancel are the only exits.
43. As a desktop pet user, I want person editing to open a temporary fullscreen preview and return to the pet after Save or Cancel, so that I can prepare the stage without changing the saved presentation mode.
44. As a stage user, I want a confirmed menu action to restore the default person layout, so that I can recover from an unwanted composition.
45. As a user, I want an interrupted person-editing session discarded if the digital human connection fails, so that only explicitly saved layouts survive recovery.
46. As a user, I want no conversation subtitles in either presentation mode, so that the visual output contains only the digital human and optional stage background.
47. As a desktop pet user, I want position and size saved 3 seconds after movement stops, so that continuous dragging does not cause excessive writes.
48. As a desktop pet user, I want pending window bounds flushed before fullscreen switching or exit, so that quick actions do not lose my latest placement.
49. As a user, I want discrete settings saved immediately and transactionally, so that visible state always matches durable configuration.
50. As a user, I want a failed discrete save rolled back with a modal error, so that the application never reports a setting as saved when it is not.
51. As a desktop pet user, I want a failed automatic bounds save to keep the current window position and show a deduplicated non-modal error, so that my window does not jump back after a delay.
52. As a user, I want failed bounds persistence retried on the next move, mode switch, or exit, so that transient write failures can recover automatically.
53. As a user, I want every exit entry point to show the same confirmation and final-save behavior, so that data protection is consistent.
54. As a user, I want a final save failure to offer Retry or Exit Anyway, so that configuration is protected without trapping me in the application.
55. As a user, I want the right-click menu to retain Re-detect Connection, so that the existing manual recovery path remains available.
56. As a user, I want stream failure to continue showing the existing automatic-access window and return to my saved presentation mode after recovery, so that presentation features do not rewrite connection behavior.
57. As a fullscreen user, I want a confirmed Exit Application item in the right-click menu, so that a borderless topmost stage has a discoverable close path.
58. As a desktop pet user, I want a right-click visual window editor with move and eight resize handles, so that a transparent frameless pet can be positioned and sized without discovering a hidden panel.
59. As a desktop pet editor, I want preview changes to remain transient until Save and Cancel to restore the entry bounds, so that experimenting never silently overwrites my durable window state.
60. As a stage user, I want legacy single-scale layouts migrated to equal width and height scales, so that upgrading preserves the previous composition.

## Implementation Decisions

- Treat presentation mode, configured background selection, effective background rendering, desktop-pet bounds, and stage-person layout as separate state. In particular, an unavailable configured media background remains selected while its effective rendering falls back to transparent.
- Extend configuration normalization so it preserves existing connection fields and desktop bounds while validating the new presentation mode, background kind, media absolute path, and relative person layout. Missing or invalid new fields fall back to desktop pet mode, transparent background, and default person layout.
- Introduce one main-process presentation coordinator as the primary state-transition seam. It owns transactional configuration changes, BrowserWindow mode application, target-display selection, high-level always-on-top state, native context-menu construction, dialogs, background file polling metadata, and exit orchestration.
- Keep the preload bridge narrow and capability-based. The renderer receives presentation snapshots and invokes named presentation actions; it never gains unrestricted filesystem or Electron access.
- Introduce one renderer stage-view seam that owns effective background elements, media validation feedback, independent digital-human width/height transforms, edit-frame interaction, temporary preview state, and subtitle suppression.
- Keep desktop-pet bounds independent from fullscreen display bounds. Suppress bounds persistence while fullscreen, temporary preview, or visual desktop editing is active. Ordinary desktop-pet move and resize use a 3-second trailing debounce; visual desktop editing is transactional and persists only on Save.
- Cover the complete Electron display bounds rather than work-area bounds so fullscreen includes the taskbar. Resolve the initial target from the desktop-pet window's display with the largest intersection.
- Apply the strongest practical Electron always-on-top level to both presentation modes. Windows secure desktop, UAC, lock screen, and similar operating-system surfaces remain outside application control.
- Disable the page drag region in fullscreen and temporary preview. Ordinary fullscreen pointer interaction is inert except for right-click context menu; edit mode enables only the edit frame and fixed Save/Cancel controls.
- Represent stage-person position as normalized center coordinates and size as independent positive finite width and height multipliers relative to the default fit-height frame. Legacy `scale` migrates to equal width and height multipliers. Keep the default aspect ratio, allow explicit deformation through edge/corner handles, and clamp the center into normalized display bounds.
- Use the selected media's original absolute path. Maintain separate configured background kind and selected media path so transparent selection can retain media and missing media can auto-restore.
- Validate newly selected media before committing configuration. Images and GIFs must decode; MP4 must reach a playable decoded state. File-picker cancellation is a no-op.
- Render every background type with centered `cover`. MP4 is muted, looping, autoplaying, and control-free. Tear down background DOM/media resources whenever fullscreen or temporary preview ends.
- While configured media is actively relevant, poll its existence and file metadata every 3 seconds. A missing file produces effective transparent rendering without changing configured selection. A changed or restored file replaces the current render only after successful decoding.
- Build one native context menu for both modes. Stage controls remain enabled in desktop pet mode so users can prepare fullscreen settings, and desktop mode adds a dedicated visual window editor. During either editor the context menu is suppressed.
- Keep normal `Esc` handling disabled in fullscreen and edit states. Preserve `Alt+F4` as an exit entry point, but route it through the unified confirmation and final-save workflow.
- Remove visual subtitle rendering in both modes while leaving conversation, audio, and connection message handling intact.
- Preserve the existing automatic-access lifecycle. Main display hiding releases stage media and discards unsaved person-layout drafts; successful reconnection reapplies the durable presentation state.
- Treat discrete settings as transactions: validate, apply, persist, and commit; on any failure restore the previous visual/window state and configuration, then show a modal error.
- Treat desktop bounds auto-save failures as non-transactional: keep the current bounds, show one deduplicated non-modal error for the active failure, and retry at the next persistence trigger.
- Route all user-driven exits through a shared coordinator. If final persistence fails, keep the application open until the user chooses Retry or Exit Anyway.

## Testing Decisions

- Prefer observable state transitions and rendered/window behavior over private helper assertions. A good test starts from configuration plus an external action and verifies the resulting durable configuration, BrowserWindow state, menu state, renderer state, or user-visible error.
- Use the main-process presentation coordinator as the highest and primary automated seam. Inject fake window, display, dialog, configuration storage, timer, and media-probe ports so a single suite can cover mode transactions, display migration, menus, polling, save rollback, bounds debounce, and exit flows without asserting internal call order.
- Use renderer stage-view and desktop-editor public interfaces for behavior that cannot be observed at the main-process coordinator: `cover` geometry, independent person width/height, eight-way resizing, transactional desktop bounds, media teardown, hot replacement, and subtitle absence. Use DOM and media fakes rather than real codecs in routine tests.
- Keep a small Electron/Playwright smoke seam for native integration only: complete-display bounds, high-level always-on-top, frame and transparency flags, context-menu wiring, file and confirmation dialogs, preload isolation, mode restoration, and automatic-access handoff.
- Extend the existing pure window-bounds tests for 3-second debounce flush, disconnected-display correction, and the rule that fullscreen bounds never overwrite desktop-pet bounds.
- Extend existing renderer and automatic-access regression tests to prove that stream discovery, candidate replacement, connection recovery, and Re-detect Connection remain unchanged.
- Cover configuration migration from legacy JSON, invalid-field normalization, round-trip preservation of every new field, and failure to write configuration.
- Cover background behavior for every allowed extension, decode rejection, file-picker cancellation, configured-versus-effective state, unavailable menu state, 3-second restoration, metadata hot update, failed hot update, MP4 lifecycle, and resource teardown.
- Cover person layout defaults, legacy-scale migration, normalized cross-display mapping, independent width/height, center constraint, temporary preview mode isolation, both editors' Save/Cancel behavior, reset confirmation, connection loss during editing, and save failure rollback.
- Do not make routine unit tests depend on actual monitor hardware, native codecs, real filesystem timing, or a running Python service; reserve those dependencies for bounded smoke/manual verification.

## Out of Scope

- Mouse click-through in fullscreen or transparent stage mode.
- Direct target-display switching while fullscreen.
- Per-display stage-person layouts.
- Background pan, zoom, focal-point selection, or per-media fit modes.
- Person-layout editing inside the desktop-pet window.
- Numeric person-layout controls or keyboard nudging.
- Copying selected media into application-managed storage.
- Background formats other than PNG, JPG/JPEG, WebP, BMP, GIF, and MP4.
- Background audio or visible media playback controls.
- Conversation subtitles in either presentation mode.
- Replacing the existing automatic stream discovery and recovery workflow.
- Covering Windows secure desktop, UAC, lock screen, or equivalent privileged operating-system surfaces.

## Further Notes

- “Fullscreen stage mode,” “desktop pet mode,” “stage background,” and “stage person layout” use the canonical vocabulary defined in the project domain glossary.
- The existing main display window is already transparent, borderless, and standard always-on-top. The feature adds mode-aware complete-display bounds, stronger topmost behavior, media layering, relative person layout, and durable state separation.
- The current digital-human plane fills the viewport without preserving aspect ratio. Fullscreen support must therefore change the render transform rather than merely enlarge the BrowserWindow.
- Existing configuration normalization currently whitelists only connection data and one window-bounds object. Schema extension is mandatory or new presentation fields will be silently discarded on later writes.
- No ADR is created for this feature because the selected interaction and storage policies are locally reversible and do not meet the project's threshold for a durable architectural decision record.
