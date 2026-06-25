export function WorkflowBuilderStyles() {
  return (
    <style>{`
      * { -webkit-font-smoothing: antialiased; text-rendering: optimizeLegibility; }
      .scroll-thin { scrollbar-width: thin; scrollbar-color: #e2e8f0 transparent; }
      .scroll-thin::-webkit-scrollbar { width: 10px; height: 10px; }
      .scroll-thin::-webkit-scrollbar-thumb { background: #e5e7eb; border-radius: 9999px; border: 3px solid #fff; }
      .scroll-thin::-webkit-scrollbar-thumb:hover { background: #cbd5e1; }
      .scroll-thin::-webkit-scrollbar-track { background: transparent; }

      .canvas-grid {
        background-color: #f7f8fa;
        background-image: radial-gradient(rgba(100, 116, 139, .30) 1px, transparent 1px);
        background-size: 22px 22px;
      }

      .builder-view { position: absolute; inset: 0; }
      .fade-enter { animation: viewFade .28s ease both; }
      @keyframes viewFade { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }

      /* Important: never animate transform on .react-flow__node-coreNode.
         React Flow uses transform: translate(x, y) on that wrapper for positioning.
         Animating it makes nodes collapse to the top-left while edges stay in place. */
      .react-flow__node-coreNode { animation: none !important; }
      .react-flow__node-coreNode .core-node { animation: nodeIn .42s cubic-bezier(.2,.85,.25,1) both; }
      @keyframes nodeIn { from { opacity: 0; transform: translateY(10px) scale(.97); } to { opacity: 1; transform: none; } }

      .core-node .node-card { cursor: grab; transition: transform .18s ease, box-shadow .2s ease; will-change: transform; }
      .core-node:hover .node-card { box-shadow: 0 0 0 1px rgba(var(--glow-rgb), .40), 0 14px 32px -12px rgba(var(--glow-rgb), .50), 0 6px 14px -8px rgba(0,0,0,.18); }
      .core-node.selected .node-card { box-shadow: 0 0 0 2px #fff, 0 0 0 4px rgba(251,191,36,.95), 0 16px 32px -12px rgba(0,0,0,.18) !important; }
      .core-node.testing .node-card { box-shadow: 0 0 0 2px #fff, 0 0 0 5px rgba(var(--glow-rgb), .6), 0 16px 36px -10px rgba(var(--glow-rgb), .55) !important; transform: scale(1.035); }
      .core-node .node-title { outline: none; border-radius: 5px; }

      .core-port.react-flow__handle { width: 13px !important; height: 13px !important; border-radius: 9999px !important; border: 2.5px solid #fff !important; cursor: crosshair; box-shadow: 0 0 0 1px rgba(15,23,42,.10), 0 1px 3px rgba(0,0,0,.22); z-index: 6; transition: transform .15s ease, box-shadow .15s ease; }
      .core-port.react-flow__handle:hover { transform: translate(-50%, -50%) scale(1.4) !important; box-shadow: 0 0 0 4px rgba(99,102,241,.18), 0 2px 5px rgba(0,0,0,.25); }
      .core-port.react-flow__handle-bottom:hover { transform: translate(-50%, 50%) scale(1.4) !important; }

      .workflow-edge path.react-flow__edge-path {
        stroke-dasharray: 6 7;
        animation: core-edge-flow 1s linear infinite;
        filter: drop-shadow(0 0 5px rgba(245, 158, 11, .2));
      }
      .workflow-edge.edge-amber path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(245, 158, 11, .35)); }
      .workflow-edge.edge-violet path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(139, 92, 246, .28)); }
      .workflow-edge.edge-orange path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(249, 115, 22, .28)); }
      .workflow-edge.edge-green path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(34, 197, 94, .28)); }
      .workflow-edge.edge-blue path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(59, 130, 246, .28)); }
      .workflow-edge.edge-red path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(239, 68, 68, .28)); }
      .workflow-edge.edge-slate path.react-flow__edge-path { filter: drop-shadow(0 0 6px rgba(100, 116, 139, .22)); }
      .react-flow__edge.selected path.react-flow__edge-path, .react-flow__edge:focus path.react-flow__edge-path { stroke-width: 3.6 !important; stroke-dasharray: 7 8 !important; animation-duration: .5s !important; filter: drop-shadow(0 0 5px rgba(245,158,11,.55)); }
      .react-flow__edge-textbg { stroke: rgba(226, 232, 240, .9); stroke-width: 1px; }
      @keyframes core-edge-flow { to { stroke-dashoffset: -26; } }

      .slider { -webkit-appearance: none; appearance: none; height: 6px; border-radius: 9999px; outline: none; background: linear-gradient(to right, #f59e0b 0%, #f59e0b var(--p,70%), #e2e8f0 var(--p,70%), #e2e8f0 100%); }
      .slider::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 18px; height: 18px; border-radius: 9999px; background: #fff; border: 2px solid #f59e0b; box-shadow: 0 1px 4px rgba(0,0,0,.22); cursor: pointer; }
      .slider::-moz-range-thumb { width: 18px; height: 18px; border-radius: 9999px; background: #fff; border: 2px solid #f59e0b; cursor: pointer; }

      .toggle { width: 40px; height: 22px; border-radius: 9999px; background: #e2e8f0; position: relative; cursor: pointer; transition: background .2s ease; flex: none; }
      .toggle.on { background: #f59e0b; }
      .toggle .knob { position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 9999px; background: #fff; box-shadow: 0 1px 3px rgba(0,0,0,.25); transition: left .2s ease; }
      .toggle.on .knob { left: 20px; }

      .phone-shell { box-shadow: 0 40px 80px -20px rgba(15,23,42,.45), 0 0 0 1px rgba(15,23,42,.06); }
      .workflow-modal-card { animation: modalIn .3s cubic-bezier(.2,.85,.25,1) both; }
      @keyframes modalIn { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: none; } }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

      .builder-tooltip { position: relative; }
      .builder-tooltip .builder-tooltip-body { position: absolute; bottom: 135%; right: 0; background: #0f172a; color: #fff; font-size: 11px; padding: 6px 9px; border-radius: 8px; white-space: nowrap; opacity: 0; pointer-events: none; transform: translateY(4px); transition: all .15s ease; box-shadow: 0 8px 20px -6px rgba(0,0,0,.4); }
      .builder-tooltip:hover .builder-tooltip-body { opacity: 1; transform: none; }

      @media (prefers-reduced-motion: reduce) {
        * { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
        .workflow-edge path.react-flow__edge-path { animation: none; }
      }
    `}</style>
  );
}
