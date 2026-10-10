# Canvas floor as independent SVG

The canvas v2 boards (E1-Office, E2-Department) previously used baked PNG
illustrations with the labels painted in. These are the replacement: the floor
as independent, editable SVG — vector rooms, status rings and labels (name +
count chips), with the illustrated people referenced as separate `/_blob/`
sprite assets (not baked in, not data-URIs).

- `generate.mjs` emits `office.inline.svg` and `military.inline.svg` (the `/_blob`
  sprite ids are the ones uploaded to the canvas artifact).
- These are inlined directly into the E1/E2 boards (the Design canvas strips
  embedded raster from *uploaded* SVGs, so the SVG must be inline and reference
  the sprites by `/_blob/` URL).
- Rooms, labels, counts and status are now editable vector; the people stay as
  the dev pack's illustrations.

Note: the Design-canvas renderer could not be previewed from this session; if a
board shows rooms/labels but no people, the DC sanitiser stripped inline
`<image>` and the boards should revert to the PNG blobs
(office 1c98d3e4…, military 2dc3c0b9…).
