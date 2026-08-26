window.__ModuleLoader__.load({ id: "dsh-plugin-flow-tracer", factory: (require) => { var module = { exports: {} }; var exports = module.exports;
"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/client/index.ts
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/client/flow-tab.tsx
var import_react = require("react");
var import_jsx_runtime = require("react/jsx-runtime");
var PORTS = [9527, 9528, 9529, 9530, 9531, 9532];
async function discoverPort() {
  const results = await Promise.all(
    PORTS.map(async (p) => {
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 300);
        const res = await fetch(`http://127.0.0.1:${p}/plugins`, { signal: ctrl.signal });
        clearTimeout(timer);
        return res.ok ? p : null;
      } catch {
        return null;
      }
    })
  );
  return results.find((x) => x !== null) ?? null;
}
var wrap = {
  width: "100%",
  height: "100%",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  color: "#666",
  fontSize: 13
};
function FlowTab(props) {
  const sessionId = props?.sessionId ?? props?.session?.id ?? null;
  const [port, setPort] = (0, import_react.useState)("searching");
  const [alive, setAlive] = (0, import_react.useState)("waiting");
  const [loaded, setLoaded] = (0, import_react.useState)(false);
  const portRef = (0, import_react.useRef)(null);
  (0, import_react.useEffect)(() => {
    let cancelled = false;
    discoverPort().then((p) => {
      if (cancelled) return;
      portRef.current = p;
      setPort(p);
    });
    return () => {
      cancelled = true;
    };
  }, []);
  (0, import_react.useEffect)(() => {
    const onMsg = (e) => {
      if (e.data?.source === "dsh-flow-viewer" && e.data?.type === "ready") setAlive(true);
    };
    window.addEventListener("message", onMsg);
    return () => window.removeEventListener("message", onMsg);
  }, []);
  (0, import_react.useEffect)(() => {
    if (!loaded || alive !== "waiting") return;
    const t = setTimeout(() => setAlive((a) => a === "waiting" ? false : a), 2500);
    return () => clearTimeout(t);
  }, [loaded, alive]);
  if (port === "searching") return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: wrap, children: "\u6B63\u5728\u8FDE\u63A5\u6570\u636E\u6D41\u670D\u52A1\u2026" });
  if (port === null) {
    return /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: wrap, children: "\u672A\u68C0\u6D4B\u5230 flow-tracer \u670D\u52A1\uFF08127.0.0.1:9527-9532\uFF09\uFF0C\u786E\u8BA4 DSH \u5DF2\u52A0\u8F7D\u8BE5\u63D2\u4EF6" });
  }
  const params = new URLSearchParams();
  params.set("embed", "1");
  if (sessionId) params.set("session", sessionId);
  const src = `http://127.0.0.1:${port}/?${params.toString()}`;
  return /* @__PURE__ */ (0, import_jsx_runtime.jsxs)("div", { style: { position: "relative", width: "100%", height: "100%" }, children: [
    /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
      "iframe",
      {
        src,
        title: "DSH \u6570\u636E\u6D41",
        onLoad: () => setLoaded(true),
        style: {
          width: "100%",
          height: "100%",
          border: "1px solid #d0d3d9",
          borderRadius: 10,
          background: "#1a1b1e",
          display: "block"
        }
      }
    ),
    alive === false && /* @__PURE__ */ (0, import_jsx_runtime.jsxs)(
      "div",
      {
        style: {
          position: "absolute",
          inset: 0,
          display: "flex",
          flexDirection: "column",
          gap: 10,
          alignItems: "center",
          justifyContent: "center",
          background: "rgba(255,255,255,0.92)",
          borderRadius: 10,
          color: "#444",
          fontSize: 13,
          textAlign: "center",
          padding: 24
        },
        children: [
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { children: "iframe \u5DF2\u52A0\u8F7D\u4F46 viewer \u672A\u54CD\u5E94\uFF0C\u53EF\u80FD\u88AB\u5BBF\u4E3B\u5B89\u5168\u7B56\u7565\u62E6\u622A\u3002" }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)("div", { style: { fontFamily: "monospace", fontSize: 11, color: "#888" }, children: src }),
          /* @__PURE__ */ (0, import_jsx_runtime.jsx)(
            "button",
            {
              onClick: () => window.open(src.replace("embed=1&", ""), "_blank"),
              style: {
                padding: "6px 14px",
                borderRadius: 6,
                border: "1px solid #c6c9cf",
                background: "#fff",
                cursor: "pointer",
                fontSize: 13
              },
              children: "\u72EC\u7ACB\u7A97\u53E3\u6253\u5F00"
            }
          )
        ]
      }
    )
  ] });
}

// src/client/index.ts
var name = "dsh-plugin-flow-tracer-client";
var inject = ["slots"];
function apply(ctx) {
  const register = () => ctx.slots.register(
    {
      name: "conversation.view",
      id: "flow",
      order: 20,
      label: () => "\u6570\u636E\u6D41"
    },
    FlowTab
  );
  if (typeof ctx.slots?.inject === "function") {
    ctx.slots.inject("conversation.view", register);
  } else if (ctx.slots) {
    register();
  }
}
return module.exports; } });
