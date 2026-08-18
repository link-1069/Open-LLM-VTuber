# Electron Desktop

## Automatic digital human connection

The desktop application discovers and displays the active digital human stream automatically. No WHEP URL entry or confirmation button is required.

On startup, the automatic-access window appears immediately while the Python service and hidden main display window start in parallel. The application then:

1. Requests `http://localhost:8500/api/active-streams` and reads `stream.av_stream_id`.
2. Verifies that `http://127.0.0.1:1985/api/v1` returns HTTP 2xx.
3. Saves the generated WHEP URL and preloads the stream in the hidden display window.
4. Shows the digital human only after a decoded video frame has been rendered by Three.js.

Detection starts immediately and repeats every second without overlapping requests. ID discovery and the SRS probe each time out after three seconds. WHEP connection has a ten-second limit, followed by a maximum two-minute wait for the first rendered frame. Failed stream IDs cool down for five seconds while detection continues.

The access window reports the current round, complete stream ID, SRS probe state, failure reason, retry timing, WHEP connection countdown, and first-frame countdown. Configuration-clear errors remain visible while detection continues and disappear after configuration is written successfully.

While the avatar is visible, discovery continues in the background. A validated replacement stream is prepared off-screen and replaces the current stream only after its first rendered frame and configuration save both succeed. Right-click the main window and select **重新检测连接** to discard the current stream and restart automatic detection.

Closing either the automatic-access window or the main display window exits the application and stops its managed Python process.

## Presentation modes

Right-click the main display window to switch between **桌面宠物模式** and **全屏舞台模式**. Both modes are borderless and use Electron's high-level always-on-top behavior. Fullscreen stage covers the complete display containing the desktop pet, including the taskbar; return to desktop-pet mode before moving the stage to another display.

The **舞台背景** submenu can keep the stage transparent or reference a local PNG, JPG/JPEG, WebP, BMP, GIF, or MP4 file. Media remains at its original path, uses centered `cover`, and is decoded before a selection is saved. MP4 files autoplay silently and loop. Missing saved media falls back to transparency and is checked every three seconds while the fullscreen media background is relevant. Clearing the selected path requires confirmation.

Select **编辑人物大小和位置…** to open the visual editor. Drag the visible frame to move the person and use the mouse wheel over the frame to scale it. Only **保存** persists the relative layout; **取消** restores the last saved layout. Starting the editor from desktop-pet mode uses a temporary fullscreen preview and returns to the desktop pet after either action.

Presentation mode, background selection, and person layout are saved immediately. Every application exit entry point asks for confirmation and performs a final desktop-bounds save check.

## Desktop window controls

The Electron main display window includes a hidden window-control panel for positioning and sizing the desktop avatar.

## Open and close the panel

- Left-click the invisible `50×50px` hotspot in the top-right corner three times within five seconds.
- Close the panel by triple-clicking the hotspot again, selecting the close button, or pressing `Esc`.
- Clicking outside the panel does not close it.

## Change the window bounds

The panel displays `x`, `y`, `width`, and `height` in Electron logical pixels (DIP), labelled as `px`.

- Enter an integer and press `Enter`, or move focus out of the field, to apply all four values.
- Width and height must be at least `320×240px`.
- Negative coordinates are supported for displays positioned above or to the left of the primary display.
- At least `50×50px` of the window must remain visible on a connected display.
- Invalid values leave the window unchanged and display an error next to the affected field.

Changes made through the panel are saved immediately. Moving or resizing the window directly is saved approximately three seconds after the operation stops. The saved desktop-pet bounds are shared across all WHEP connections and restored independently of fullscreen-stage bounds the next time the main display window opens.

If the saved bounds are outside the current display layout, the application moves the window back into the primary display's work area and saves the corrected position.

## Restore defaults

Select **恢复默认** to restore the window to `480×800px`. The window is centered in the work area of the display that contains the largest part of its current bounds, and the result is saved immediately.

The panel reports automatic-save failures without reverting the current position or size. A later move, resize, or field update retries the save.
