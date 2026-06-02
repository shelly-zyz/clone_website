# OpenGridWorks Page Topology

Target URL: https://opengridworks.com/power-plants

## View

OpenGridWorks resolves the home URL into a full-screen power-plants map. The page is a fixed-height GIS interface rather than a scrolling marketing page.

## Desktop Structure

1. Left navigation rail, 64px wide, dark navy, with logo, active Plants item, and sign-in control pinned near the bottom.
2. Floating legend panel at x=80, y=16, around 260px wide. It contains the Power Plants title, beta chip, Operating plants row, technology legend, size bubble legend, data-center toggles, transmission and substation groups.
3. Map surface fills the viewport. It uses a near-black slate background with thin cyan diagonal transmission/submarine cable strokes, subtle country/region outlines, and a compact scale/attribution cluster.
4. Floating search/select controls sit just to the right of the legend panel.
5. Top toolbar runs across the upper-right edge with a live-user count and square icon buttons.
6. Cable detail popover is centered over the map, with Pacific Crossing-1 content and a Telegeography source chip.
7. Layer switcher thumbnails sit in the bottom-left map area, and a circular minimap sits bottom-right.

## Mobile Structure

1. Left rail and legend panel collapse away.
2. A full-width search bar sits at the top with a menu icon and placeholder text.
3. Filter chips for Renewables, Gas, and In Development sit beneath the search.
4. Logo and layer thumbnail float over the map.
5. Cable popover becomes the dominant mid/lower overlay.
6. Bottom sheet handle and label show the active Power Plants panel.

## Interaction Model

The clone uses static demo data with UI affordances. Hover states brighten controls, the map marker pulses, cyan map lines drift slightly, and the popup/controls retain the target's glassy fixed-position behavior. No backend, real map tiles, authentication, or live GIS filtering are in scope.
