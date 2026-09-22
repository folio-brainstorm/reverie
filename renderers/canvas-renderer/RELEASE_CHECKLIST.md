# Renderer release browser checklist

Run the fixed-image browser tests before release on the supported desktop
browser matrix.

- Chrome 120 or newer passes the minification browser tests.
- Edge 120 or newer passes the minification browser tests.
- Firefox 120 or newer passes the minification browser tests.
- Safari 17 or newer is checked manually on a real macOS device for diagonal
  lines, curves, transparent edges, four-Tile intersections, gradual zoom, and
  subpixel panning. Playwright WebKit is not accepted as a substitute for this
  Safari check.
