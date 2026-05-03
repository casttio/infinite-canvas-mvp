import type { PointerEvent as ReactPointerEvent } from "react";
import type { CanvasNode, ConnectorNode, PageBounds } from "../model/types";
import { resolveConnectorEndpoint } from "./connectorGeometry";

interface ConnectorLayerProps {
  connectors: ConnectorNode[];
  nodes: CanvasNode[];
  pageBounds: PageBounds;
  selectedNodeIds: string[];
  temporaryConnector?: { x1: number; y1: number; x2: number; y2: number } | null;
  onEndpointPointerDown: (
    event: ReactPointerEvent<SVGCircleElement>,
    connector: ConnectorNode,
    endpoint: "start" | "end",
  ) => void;
}

const dashArrayForStyle = (lineStyle: ConnectorNode["lineStyle"]) => {
  if (lineStyle === "dashed") {
    return "8 4";
  }

  if (lineStyle === "dotted") {
    return "2 5";
  }

  return undefined;
};

const markerUrl = (marker: ConnectorNode["endMarker"], id: string) => {
  if (marker === "arrow") {
    return `url(#${id}-arrow)`;
  }

  if (marker === "circle") {
    return `url(#${id}-circle)`;
  }

  return undefined;
};

export const ConnectorLayer = ({
  connectors,
  nodes,
  pageBounds,
  selectedNodeIds,
  temporaryConnector,
  onEndpointPointerDown,
}: ConnectorLayerProps) => (
  <svg
    className="connector-layer"
    style={{
      left: pageBounds.x,
      top: pageBounds.y,
      width: pageBounds.w,
      height: pageBounds.h,
    }}
    viewBox={`${pageBounds.x} ${pageBounds.y} ${pageBounds.w} ${pageBounds.h}`}
  >
    <defs>
      <marker id="connector-arrow" viewBox="0 0 10 10" refX="10" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse">
        <path d="M 0 0 L 10 5 L 0 10 z" fill="currentColor" />
      </marker>
      <marker id="connector-circle" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="7" markerHeight="7" orient="auto">
        <circle cx="5" cy="5" r="4" fill="currentColor" />
      </marker>
    </defs>
    {connectors.map((connector) => {
      const start = resolveConnectorEndpoint(connector, "start", nodes);
      const end = resolveConnectorEndpoint(connector, "end", nodes);
      const selected = selectedNodeIds.includes(connector.id);
      const midX = (start.x + end.x) / 2;
      const midY = (start.y + end.y) / 2;

      return (
        <g
          key={connector.id}
          className={`connector-item ${selected ? "selected" : ""}`}
          style={{ color: connector.stroke }}
        >
          <line
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={connector.stroke}
            strokeWidth={connector.strokeWidth}
            strokeDasharray={dashArrayForStyle(connector.lineStyle)}
            markerStart={markerUrl(connector.startMarker, "connector")}
            markerEnd={markerUrl(connector.endMarker, "connector")}
          />
          {connector.label ? (
            <text x={midX} y={midY - 8} textAnchor="middle" className="connector-label">
              {connector.label}
            </text>
          ) : null}
          {selected ? (
            <>
              <circle
                className="connector-endpoint"
                cx={start.x}
                cy={start.y}
                r={6}
                onPointerDown={(event) => onEndpointPointerDown(event, connector, "start")}
              />
              <circle
                className="connector-endpoint"
                cx={end.x}
                cy={end.y}
                r={6}
                onPointerDown={(event) => onEndpointPointerDown(event, connector, "end")}
              />
            </>
          ) : null}
        </g>
      );
    })}
    {temporaryConnector ? (
      <line
        className="connector-temporary"
        x1={temporaryConnector.x1}
        y1={temporaryConnector.y1}
        x2={temporaryConnector.x2}
        y2={temporaryConnector.y2}
      />
    ) : null}
  </svg>
);
