if (!self.define) {
  let e,
    c = {};
  const s = (s, r) => (
    (s = new URL(s + ".js", r).href),
    c[s] ||
      new Promise((c) => {
        if ("document" in self) {
          const e = document.createElement("script");
          (e.src = s), (e.onload = c), document.head.appendChild(e);
        } else (e = s), importScripts(s), c();
      }).then(() => {
        let e = c[s];
        if (!e) throw new Error(`Module ${s} didn’t register its module`);
        return e;
      })
  );
  self.define = (r, i) => {
    const n = e || ("document" in self ? document.currentScript.src : "") || location.href;
    if (c[n]) return;
    let o = {};
    const f = (e) => s(e, n),
      b = { module: { uri: n }, exports: o, require: f };
    c[n] = Promise.all(r.map((e) => b[e] || f(e))).then((e) => (i(...e), o));
  };
}
define(["./workbox-7839e0cf"], function (e) {
  "use strict";
  self.addEventListener("message", (e) => {
    e.data && "SKIP_WAITING" === e.data.type && self.skipWaiting();
  }),
    e.precacheAndRoute(
      [
        {
          url: "2078a57b79d547bf1e2502f8d249b867.woff",
          revision: "7b1b8e3c63a860311c7eca3ef22b6758",
        },
        {
          url: "58cebbe9a6bdcba6d4bb56a22a9e812f.woff",
          revision: "2c98cb04bf6caba32908e72a920435eb",
        },
        { url: "blue.css", revision: "600cbfe27942495cf6856b9c503ee750" },
        { url: "green.css", revision: "4868987224751aec2dec7181ca15589f" },
        { url: "languageSelector.js", revision: "79eb34293cf8092c55ff0ebb21faac4e" },
        { url: "main.js", revision: "7811d682323fca4b6fe9c1a3634cdb56" },
        { url: "pink.css", revision: "8146d24e3313cabe8cb2d0d74e33e534" },
        { url: "prism.js", revision: "dd3e8044f52e9ba68cf15f0933d66351" },
        { url: "red.css", revision: "ec1e32a3b65b3dc5bc57327239eb1441" },
        { url: "style.css", revision: "ae3c2c7a49eadd6d5334485eaee2f3a1" },
      ],
      { ignoreURLParametersMatching: [/^utm_/, /^fbclid$/] },
    );
});
//# sourceMappingURL=sw.js.map
