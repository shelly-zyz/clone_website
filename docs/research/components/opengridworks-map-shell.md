# Component Spec: OpenGridWorks Map Shell

## Foundation

- Full viewport application shell with `overflow: hidden`.
- Background: `#151d24` / `#101821` dark map field with subtle radial glows.
- Map marks: cyan diagonal cable/transmission lines, faint region borders, animated central aqua pulse.
- Typography: Inter/system sans for UI; IBM Plex Mono for source chips and small technical labels.

## Desktop Components

- `NavRail`: fixed 64px left rail, logo at top, active Plants square, sign-in icon near bottom.
- `LegendPanel`: 260px wide glass panel, top 16px, left 80px. Sections include Technology, Size (MW), Data Centers, Transmission, Substations.
- `MapTools`: search button, logo button, spotlight button.
- `TopToolbar`: active users count and compact square icon buttons.
- `CablePopup`: 320px dark tooltip centered over the map with close icon and details table.
- `LayerCards`: three 77px thumbnails near bottom-left of the map.
- `MiniMap`: 120px circular minimap bottom-right with glowing marker.

## Mobile Components

- `MobileSearch`: top search bar with menu icon and placeholder.
- `MobileChips`: horizontal scroll chips.
- `LegendPanel` and desktop toolbar hidden.
- `CablePopup` resized to viewport width and placed lower.
- `BottomSheetHandle` fixed at bottom with Power Plants label.

## States

- Default active state uses cyan borders and glows.
- Hover on icon buttons increases border and text brightness.
- Mobile chips keep the first chip active with a cyan dot.
