# Desktop Window Controls

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

Changes made through the panel are saved immediately. Moving or resizing the window directly is saved approximately 300 ms after the operation stops. The saved bounds are shared across all WHEP connections and restored the next time the main display window opens.

If the saved bounds are outside the current display layout, the application moves the window back into the primary display's work area and saves the corrected position.

## Restore defaults

Select **恢复默认** to restore the window to `480×800px`. The window is centered in the work area of the display that contains the largest part of its current bounds, and the result is saved immediately.

The panel reports automatic-save failures without reverting the current position or size. A later move, resize, or field update retries the save.
