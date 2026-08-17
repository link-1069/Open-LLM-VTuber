# Electron Desktop

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
