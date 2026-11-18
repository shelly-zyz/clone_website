"use client";

import { AttributionControl, type Map } from "maplibre-gl";
import { useEffect, useState, type RefObject } from "react";
import { ControlGroup, GlobeControls } from "./GlobeLayout";

export function GlobeMapAttribution({ map }: { map: RefObject<Map | null> }) {
  const [host, setHost] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!host || !map.current) return;
    const control = new AttributionControl({ compact: false });
    host.append(control.onAdd(map.current));
    return () => control.onRemove();
  }, [host, map]);
  return <GlobeControls><ControlGroup title="底图署名"><div className="og-map-attribution" ref={setHost} /></ControlGroup></GlobeControls>;
}
