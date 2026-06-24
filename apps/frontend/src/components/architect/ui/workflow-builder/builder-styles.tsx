export function WorkflowBuilderStyles() {
  return (
    <style>{`
      .workflow-edge path.react-flow__edge-path {
        stroke-dasharray: 9 9;
        animation: core-edge-flow 0.85s linear infinite;
        filter: drop-shadow(0 0 5px rgba(245, 158, 11, 0.2));
      }

      .workflow-edge.edge-amber path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(245, 158, 11, 0.35)); }
      .workflow-edge.edge-violet path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(139, 92, 246, 0.28)); }
      .workflow-edge.edge-orange path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(249, 115, 22, 0.28)); }
      .workflow-edge.edge-green path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(16, 185, 129, 0.28)); }
      .workflow-edge.edge-blue path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(59, 130, 246, 0.28)); }
      .workflow-edge.edge-red path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(239, 68, 68, 0.28)); }
      .workflow-edge.edge-slate path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(100, 116, 139, 0.22)); }

      .react-flow__edge.selected path.react-flow__edge-path,
      .react-flow__edge:focus path.react-flow__edge-path {
        stroke-width: 3.4 !important;
        stroke-dasharray: 6 6;
        animation-duration: 0.48s;
      }

      .react-flow__edge-textbg {
        stroke: rgba(226, 232, 240, 0.9);
        stroke-width: 1px;
      }

      @keyframes core-edge-flow {
        to { stroke-dashoffset: -36; }
      }

      @media (prefers-reduced-motion: reduce) {
        .workflow-edge path.react-flow__edge-path {
          animation: none;
        }
      }
    `}</style>
  );
}
