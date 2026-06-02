# OpenGridWorks Behavior Notes

## Observed

- The root URL redirects to `/power-plants`.
- The app is viewport-fixed; full-page screenshot height equals the viewport because the map is the page.
- Desktop shows an expanded Power Plants legend panel and many floating map controls.
- Mobile replaces the legend panel with a top search field, chip filters, and a bottom sheet handle.
- Primary visible data popup: Pacific Crossing-1 (PC-1), Pacific Crossing, source Telegeography, length 21,000 km, ready for service 1999 December, supplier SubCom, four landing points.
- The visual theme uses Inter/system sans text, IBM Plex Mono-like monospace source chips, cyan map strokes, bright technology dots, and dark translucent glass panels.

## Clone Scope

- Recreate the fixed map UI composition and visible dataset state.
- Include responsive desktop/mobile layout states.
- Use real target assets where available: logo, layers thumbnail, satellite thumbnail, NASA map thumbnail.
- Simulate map geometry with SVG/CSS strokes and dots instead of live map rendering.
- Simulate controls visually without remote data or map interactions.
