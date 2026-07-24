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

      .toggle { width: 46px; height: 26px; border-radius: 9999px; background: #e2e8f0; position: relative; cursor: pointer; transition: background .25s cubic-bezier(.16,1,.3,1); flex: none; }
      .toggle.on, .toggle[aria-checked="true"] { background: #f59e0b; box-shadow: 0 4px 12px -2px rgba(245,158,11,.5); }
      .toggle .knob { position: absolute; top: 3px; left: 3px; width: 20px; height: 20px; border-radius: 9999px; background: #fff; box-shadow: 0 1px 3px rgba(16,24,40,.25); transition: left .25s cubic-bezier(.16,1,.3,1); }
      .toggle.on .knob, .toggle[aria-checked="true"] .knob { left: 23px; }

      .shadow-soft { box-shadow: 0 1px 2px rgba(16,24,40,.04), 0 1px 3px rgba(16,24,40,.06); }
      .shadow-amber { box-shadow: 0 10px 25px -6px rgba(245,158,11,.45); }
      .shadow-amber-sm { box-shadow: 0 4px 12px -2px rgba(245,158,11,.35); }
      .shadow-lift { box-shadow: 0 18px 40px -12px rgba(16,24,40,.16), 0 4px 10px -4px rgba(16,24,40,.08); }

      .fld { transition: border-color .18s ease, box-shadow .18s ease, background .18s ease; }
      .fld:hover:not(:focus) { border-color: #e2e8f0; }
      .fld:focus-visible, input.fld:focus-visible, textarea.fld:focus-visible, select.fld:focus-visible {
        box-shadow: 0 0 0 3px rgba(245,158,11,.40);
        border-color: #fbbf24 !important;
        outline: none;
      }

      .btn-primary { transition: all .2s cubic-bezier(.16,1,.3,1); }
      .btn-primary:hover { transform: translateY(-1px); box-shadow: 0 14px 30px -8px rgba(245,158,11,.55); }
      .btn-primary:active { transform: translateY(0); }
      .btn-ghost { transition: all .18s ease; }
      .btn-ghost:hover { background: #f8fafc; border-color: #e2e8f0; }

      .seg-btn { transition: all .2s ease; }
      .seg-btn[aria-pressed="true"] { background: #fff; color: #0f172a; box-shadow: 0 1px 3px rgba(16,24,40,.12); font-weight: 600; }

      .pill { transition: all .18s cubic-bezier(.16,1,.3,1); }
      .pill[aria-pressed="true"] { background: #fffbeb; border-color: #f59e0b; color: #b45309; box-shadow: 0 2px 8px -2px rgba(245,158,11,.4); }
      .pill[aria-pressed="true"] .pill-dot { background: #f59e0b; transform: scale(1); }
      .pill-dot { transform: scale(0); transition: transform .2s cubic-bezier(.34,1.56,.64,1); }

      .ck { transition: all .18s ease; }
      .ck[aria-checked="true"] { background: #f59e0b; border-color: #f59e0b; }
      .ck[aria-checked="true"] svg { opacity: 1; transform: scale(1); }
      .ck svg { opacity: 0; transform: scale(.5); transition: all .2s cubic-bezier(.34,1.56,.64,1); }

      .price-card { transition: all .22s cubic-bezier(.16,1,.3,1); }
      .price-card[aria-pressed="true"] { border-color: #f59e0b; box-shadow: 0 12px 30px -10px rgba(245,158,11,.45); }
      .price-card[aria-pressed="true"] .price-check { opacity: 1; transform: scale(1); }
      .price-check { opacity: 0; transform: scale(.6); transition: all .25s cubic-bezier(.34,1.56,.64,1); }

      .dropzone { transition: all .22s cubic-bezier(.16,1,.3,1); }
      .dropzone:hover { border-color: #cbd5e1; background: #fafafa; }
      .dropzone.dragover { border-color: #f59e0b !important; background: #fffbeb; transform: scale(1.01); }
      .dropzone.filled { border-style: solid; border-color: #f59e0b; background: #fffbeb; }

      .lift-card { transition: box-shadow .25s ease, transform .25s ease, border-color .25s ease; }
      .lift-card:hover { box-shadow: 0 18px 40px -12px rgba(16,24,40,.16), 0 4px 10px -4px rgba(16,24,40,.08); transform: translateY(-2px); }

      .configure-step-enter { animation: configureStepIn .42s cubic-bezier(.16,1,.3,1) both; }
      @keyframes configureStepIn { from { opacity: 0; transform: translateX(22px); } to { opacity: 1; transform: translateX(0); } }

      .phone-shell { box-shadow: 0 40px 80px -20px rgba(15,23,42,.45), 0 0 0 1px rgba(15,23,42,.06); }
      .workflow-modal-card { animation: modalIn .3s cubic-bezier(.2,.85,.25,1) both; }
      @keyframes modalIn { from { opacity: 0; transform: translateY(16px) scale(.96); } to { opacity: 1; transform: none; } }
      @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }

      .builder-tooltip { position: relative; }
      .builder-tooltip .builder-tooltip-body { position: absolute; bottom: 135%; right: 0; background: #0f172a; color: #fff; font-size: 11px; padding: 6px 9px; border-radius: 8px; white-space: nowrap; opacity: 0; pointer-events: none; transform: translateY(4px); transition: all .15s ease; box-shadow: 0 8px 20px -6px rgba(0,0,0,.4); }
      .builder-tooltip:hover .builder-tooltip-body { opacity: 1; transform: none; }

      .markdown-content {
        font-size: 14px;
        line-height: 1.6;
        color: #334155;
      }
      .markdown-content h1,
      .markdown-content h2,
      .markdown-content h3,
      .markdown-content h4,
      .markdown-content h5,
      .markdown-content h6 {
        font-weight: 700;
        color: #0f172a;
        margin-top: 1.25em;
        margin-bottom: 0.5em;
        line-height: 1.25;
      }
      .markdown-content h1 { font-size: 1.65em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
      .markdown-content h2 { font-size: 1.4em; border-bottom: 1px solid #e2e8f0; padding-bottom: 0.3em; }
      .markdown-content h3 { font-size: 1.2em; }
      .markdown-content h4 { font-size: 1.1em; }
      .markdown-content p { margin-top: 0; margin-bottom: 0.85em; }
      .markdown-content p:last-child { margin-bottom: 0; }
      .markdown-content strong { font-weight: 600; color: #0f172a; }
      .markdown-content em { font-style: italic; }
      
      .markdown-content ul,
      .markdown-content ol {
        margin-top: 0;
        margin-bottom: 0.85em;
        padding-left: 1.5em;
      }
      .markdown-content ul { list-style-type: disc; }
      .markdown-content ol { list-style-type: decimal; }
      .markdown-content li { margin-top: 0.25em; margin-bottom: 0.25em; }
      .markdown-content li > p { margin-bottom: 0; }
      
      .markdown-content blockquote {
        margin: 0.85em 0;
        padding: 0 1em;
        color: #64748b;
        border-left: 0.25em solid #cbd5e1;
      }
      
      .markdown-content hr {
        height: 1px;
        padding: 0;
        margin: 1.5em 0;
        background-color: #e2e8f0;
        border: 0;
      }
      
      .markdown-content table {
        width: 100%;
        margin-top: 0.85em;
        margin-bottom: 0.85em;
        border-collapse: collapse;
        border-spacing: 0;
        display: block;
        overflow-x: auto;
      }
      .markdown-content th {
        font-weight: 600;
        background-color: #f8fafc;
        color: #0f172a;
      }
      .markdown-content th,
      .markdown-content td {
        padding: 8px 12px;
        border: 1px solid #e2e8f0;
        text-align: left;
        font-size: 13px;
      }
      .markdown-content tr:nth-child(even) {
        background-color: #fafafa;
      }
      
      .markdown-content code {
        padding: 0.2em 0.4em;
        margin: 0;
        font-size: 85%;
        background-color: rgba(15, 23, 42, 0.05);
        border-radius: 6px;
        font-family: ui-monospace, SFMono-Regular, SF Mono, Menlo, Consolas, Liberation Mono, monospace;
      }
      .markdown-content pre {
        padding: 12px;
        overflow: auto;
        font-size: 85%;
        line-height: 1.45;
        background-color: #f8fafc;
        border-radius: 6px;
        border: 1px solid #e2e8f0;
        margin-top: 0.85em;
        margin-bottom: 0.85em;
      }
      .markdown-content pre code {
        background-color: transparent;
        padding: 0;
        margin: 0;
        border-radius: 0;
        font-size: inherit;
        color: inherit;
      }

      @media (prefers-reduced-motion: reduce) {
        * { animation-duration: .001ms !important; animation-iteration-count: 1 !important; transition-duration: .001ms !important; }
        .workflow-edge path.react-flow__edge-path { animation: none; }
      }
    `}</style>
  );
}
