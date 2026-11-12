// @ts-nocheck
// FICHIER GÉNÉRÉ par packages/engine/scripts/extract.mjs — ne pas modifier à la main.
// Source : legacy/vyra-studio-0.2/index.html (sha256 ece660753f1c7e18b031728abc68806ed08848ec9ff8669b7a883a83329957f1).
// Moteur de broderie VYRA v0.2.x extrait du build publié ; 164 symboles.
// Intégrité contrôlée par test/reference.test.ts (empreintes du registre v0.2.0).
// Table de couleurs PEC : pyembroidery 1.5.1 (MIT).
const STITCH = 0,
  JUMP = 1,
  TRIM = 2,
  COLOR_CHANGE = 5,
  END = 4,
  DEFAULT_FILL = {
    angle: 45,
    spacing: 0.4,
    stitchLength: 3,
    stagger: 1 / 3,
    pullComp: 0.2,
    underlay: "edge+tatami",
    underlaySpacing: 2.5,
    underlayInset: 0.5,
  },
  DEFAULT_SATIN = {
    angle: null,
    spacing: 0.4,
    pullComp: 0.25,
    underlay: "center",
    width: 2.5,
  },
  DEFAULT_RUN = {
    stitchLength: 2.5,
    repeats: 1,
  },
  distance = (h, e) => Math.hypot(h.x - e.x, h.y - e.y);
function m_va(h) {
  let e = 0;
  for (let n = 0, s = h.length; n < s; n++) {
    const i = h[n],
      o = h[(n + 1) % s];
    e += i.x * o.y - o.x * i.y;
  }
  return e / 2;
}
function m_ao(h) {
  return Math.abs(m_va(h.outer)) - h.holes.reduce((e, n) => e + Math.abs(m_va(n)), 0);
}
function m_Sd(h) {
  let e = 0;
  for (let n = 0; n < h.length; n++) e += distance(h[n], h[(n + 1) % h.length]);
  return e;
}
function m_d3(h) {
  let e = 0;
  for (let n = 1; n < h.length; n++) e += distance(h[n - 1], h[n]);
  return e;
}
function m_Of(h) {
  let e = 1 / 0,
    n = 1 / 0,
    s = -1 / 0,
    i = -1 / 0;
  for (const o of h) (o.x < e && (e = o.x), o.y < n && (n = o.y), o.x > s && (s = o.x), o.y > i && (i = o.y));
  return {
    minX: e,
    minY: n,
    maxX: s,
    maxY: i,
  };
}
function m_lo(h, e) {
  const n = Math.cos(e),
    s = Math.sin(e);
  return {
    x: h.x * n - h.y * s,
    y: h.x * s + h.y * n,
  };
}
function m_bl(h, e) {
  return {
    outer: h.outer.map((n) => m_lo(n, e)),
    holes: h.holes.map((n) => n.map((s) => m_lo(s, e))),
  };
}
function m_wl(h, e) {
  let n = !1;
  for (const s of [e.outer, ...e.holes])
    for (let i = 0, o = s.length - 1; i < s.length; o = i++) {
      const l = s[i],
        c = s[o];
      l.y > h.y != c.y > h.y && h.x < ((c.x - l.x) * (h.y - l.y)) / (c.y - l.y) + l.x && (n = !n);
    }
  return n;
}
function m_gw(h, e) {
  const n = [];
  for (const i of [h.outer, ...h.holes])
    for (let o = 0, l = i.length; o < l; o++) {
      const c = i[o],
        u = i[(o + 1) % l];
      c.y !== u.y &&
        ((e >= c.y && e < u.y) || (e >= u.y && e < c.y)) &&
        n.push(c.x + ((e - c.y) * (u.x - c.x)) / (u.y - c.y));
    }
  n.sort((i, o) => i - o);
  const s = [];
  for (let i = 0; i + 1 < n.length; i += 2) n[i + 1] - n[i] > 1e-6 && s.push([n[i], n[i + 1]]);
  return s;
}
function m_pm(h) {
  let e = 0,
    n = 0,
    s = 0,
    i = 0,
    o = 0,
    l = 0;
  for (const p of [h.outer, ...h.holes]) {
    const g = (p === h.outer ? 1 : -1) * (Math.sign(m_va(p)) || 1);
    for (let w = 0, y = p.length; w < y; w++) {
      const v = p[w],
        j = p[(w + 1) % y],
        k = (v.x * j.y - j.x * v.y) * g;
      ((e += k / 2),
        (n += ((v.x + j.x) * k) / 6),
        (s += ((v.y + j.y) * k) / 6),
        (i += ((v.x * v.x + v.x * j.x + j.x * j.x) * k) / 12),
        (o += ((v.y * v.y + v.y * j.y + j.y * j.y) * k) / 12),
        (l += ((v.x * j.y + 2 * v.x * v.y + 2 * j.x * j.y + j.x * v.y) * k) / 24));
    }
  }
  if (Math.abs(e) < 1e-9) return 0;
  ((n /= e), (s /= e));
  const c = i / e - n * n,
    u = o / e - s * s,
    d = l / e - n * s;
  return 0.5 * Math.atan2(2 * d, c - u);
}
function m_Qd(h) {
  const e = m_Sd(h.outer) + h.holes.reduce((n, s) => n + m_Sd(s), 0);
  return e > 0 ? (2 * m_ao(h)) / e : 0;
}
function simplifyPath(h, e) {
  if (h.length < 3) return h.slice();
  const n = new Uint8Array(h.length);
  n[0] = n[h.length - 1] = 1;
  const s = [[0, h.length - 1]];
  for (; s.length;) {
    const [i, o] = s.pop(),
      l = h[i],
      c = h[o],
      u = distance(l, c) || 1e-12;
    let d = -1,
      p = -1;
    for (let g = i + 1; g < o; g++) {
      const w = h[g],
        y = Math.abs((c.x - l.x) * (l.y - w.y) - (l.x - w.x) * (c.y - l.y)) / u;
      y > d && ((d = y), (p = g));
    }
    d > e && p > 0 && ((n[p] = 1), s.push([i, p], [p, o]));
  }
  return h.filter((i, o) => n[o]);
}
function m_ub(h, e) {
  if (h.length < 6) return h.slice();
  const n = Math.floor(h.length / 2),
    s = simplifyPath(h.slice(0, n + 1), e),
    i = simplifyPath([...h.slice(n), h[0]], e),
    o = [...s.slice(0, -1), ...i.slice(0, -1)];
  return o.length >= 3 ? o : h.slice();
}
function m_m3(h, e = 1, n = 1 / 0) {
  let s = h;
  for (let i = 0; i < e; i++) {
    const o = [];
    for (let l = 0; l < s.length; l++) {
      const c = s[l],
        u = s[(l + 1) % s.length],
        d = distance(c, u);
      if (d < 1e-9) continue;
      const p = Math.min(0.25, n / d);
      (o.push({
        x: c.x + (u.x - c.x) * p,
        y: c.y + (u.y - c.y) * p,
      }),
        o.push({
          x: u.x - (u.x - c.x) * p,
          y: u.y - (u.y - c.y) * p,
        }));
    }
    s = o;
  }
  return s;
}
function m_bw(h, e) {
  if (h.length < 2) return h.slice();
  const n = [h[0]];
  for (let i = 1; i < h.length - 1; i++) distance(h[i], n[n.length - 1]) >= e && n.push(h[i]);
  const s = h[h.length - 1];
  return (distance(s, n[n.length - 1]) >= e * 0.5 || n.length === 1 ? n.push(s) : (n[n.length - 1] = s), n);
}
function m_ww(h, e) {
  if (h.length < 2) return h.slice();
  const n = [h[0]];
  let s = 0;
  for (let o = 1; o < h.length; o++) {
    const l = h[o - 1],
      c = h[o],
      u = distance(l, c);
    if (u < 1e-9) continue;
    let d = e - s;
    for (; d <= u - 1e-9;)
      (n.push({
        x: l.x + ((c.x - l.x) * d) / u,
        y: l.y + ((c.y - l.y) * d) / u,
      }),
        (d += e));
    s = u - (d - e);
  }
  const i = h[h.length - 1];
  return (distance(n[n.length - 1], i) > 1e-6 && n.push(i), n);
}
function m_Af(h, e, n) {
  const s = distance(h, e),
    i = Math.max(1, Math.ceil(s / n - 1e-9)),
    o = [];
  for (let l = 1; l <= i; l++)
    o.push({
      x: h.x + ((e.x - h.x) * l) / i,
      y: h.y + ((e.y - h.y) * l) / i,
    });
  return o;
}
function m_hb(h, e, n) {
  const s = h.length;
  if (s < 3) return h.slice();
  let o = (Math.sign(m_va(h)) || 1) > 0 ? -1 : 1;
  n && (o = -o);
  const l = [];
  for (let c = 0; c < s; c++) {
    const u = h[(c - 1 + s) % s],
      d = h[c],
      p = h[(c + 1) % s],
      g = m_db(u, d),
      w = m_db(d, p);
    let y = g.x + w.x,
      v = g.y + w.y;
    const j = Math.hypot(y, v);
    j < 1e-9 ? ((y = g.x), (v = g.y)) : ((y /= j), (v /= j));
    const k = Math.max(0.35, y * g.x + v * g.y),
      x = (e * o) / k;
    l.push({
      x: d.x + y * x,
      y: d.y + v * x,
    });
  }
  return l;
}
function m_db(h, e) {
  const n = e.x - h.x,
    s = e.y - h.y,
    i = Math.hypot(n, s) || 1;
  return {
    x: s / i,
    y: -n / i,
  };
}
function m_gm(h, e) {
  const n = Math.sign(m_va(h.outer)) || 1,
    s = m_hb(h.outer, e, !1);
  if (Math.sign(m_va(s)) !== n || Math.abs(m_va(s)) < e * e) return null;
  const i = h.holes.map((c) => m_hb(c, e, !0)).filter((c) => Math.abs(m_va(c)) > 1e-6),
    o = {
      outer: s,
      holes: i,
    };
  let l = 0;
  for (const c of s) m_wl(c, h) && l++;
  return l < s.length * 0.8 ? null : o;
}
const m_yw = Math.PI / 180;
function m_bm(h, e, n = 0.5) {
  const s = m_Of(h.outer),
    i = [];
  let o = 0;
  for (let u = s.minY + e * n; u < s.maxY; u += e)
    (i.push(
      m_gw(h, u).map(([d, p]) => ({
        y: u,
        x0: d,
        x1: p,
        idx: o,
      })),
    ),
      o++);
  const l = [];
  let c = [];
  for (const u of i) {
    const d = [],
      p = new Set();
    for (const g of u) {
      const w = c.filter((y) => {
        const v = y[y.length - 1];
        return v.x0 < g.x1 && g.x0 < v.x1;
      });
      if (w.length === 1 && !p.has(w[0])) {
        const y = w[0][w[0].length - 1];
        if (u.filter((j) => j !== g && y.x0 < j.x1 && j.x0 < y.x1).length === 0) {
          (w[0].push(g), p.add(w[0]), d.push(w[0]));
          continue;
        }
      }
      d.push([g]);
    }
    for (const g of c) d.includes(g) || l.push(g);
    c = d;
  }
  return (l.push(...c), l.filter((u) => u.length > 0));
}
function m_p3(h, e, n, s, i) {
  const o = h.x0 - s,
    l = h.x1 + s,
    c = [
      {
        x: o,
        y: h.y,
      },
    ],
    u = n * e;
  let d = Math.ceil((o - u) / e);
  for (let p = d * e + u; p < l - e * 0.25; p = ++d * e + u)
    p > o + e * 0.25 &&
      c.push({
        x: p,
        y: h.y,
      });
  return (
    c.push({
      x: l,
      y: h.y,
    }),
    i ? c.reverse() : c
  );
}
function m_wm(h, e) {
  const n = h.slice(),
    s = [];
  let i = e;
  for (; n.length;) {
    let o = 0,
      l = !1,
      c = 1 / 0;
    n.forEach((p, g) => {
      const w = distance(i, p[0]),
        y = distance(i, p[p.length - 1]);
      (w < c && ((c = w), (o = g), (l = !1)), y < c && ((c = y), (o = g), (l = !0)));
    });
    const u = n.splice(o, 1)[0],
      d = l ? u.slice().reverse() : u;
    (s.push({
      pts: d,
      end: d[d.length - 1],
    }),
      (i = d[d.length - 1]));
  }
  return s;
}
function m_vw(h, e, n, s = e.angle, i = e.spacing, o = e.stitchLength, l = e.pullComp) {
  const c = s * m_yw,
    u = m_bl(h, -c),
    p = m_bm(u, i).map((g) => {
      const w = [];
      return (
        g.forEach((y, v) => {
          const j = m_p3(y, o, (y.idx * e.stagger) % 1, l, v % 2 === 1);
          if (w.length) {
            const k = w[w.length - 1];
            for (const x of m_Af(k, j[0], o)) w.push(x);
            w.push(...j.slice(1));
          } else w.push(...j);
        }),
        w.map((y) => m_lo(y, c))
      );
    });
  return m_wm(p, n).map((g) => g.pts);
}
function m_mb(h, e, n) {
  const s = m_jw(h, e),
    i = m_bl(h, -s),
    l = m_bm(i, e.spacing).map((c) => {
      const u = [];
      for (const d of c)
        u.push(
          {
            x: d.x0 - e.pullComp,
            y: d.y,
          },
          {
            x: d.x1 + e.pullComp,
            y: d.y,
          },
        );
      return u.map((d) => m_lo(d, s));
    });
  return m_wm(l, n).map((c) => c.pts);
}
function m_jw(h, e) {
  return e.angle == null ? m_pm(h) + Math.PI / 2 : e.angle * m_yw;
}
function m_g3(h, e, n, s = 2) {
  const i = m_jw(h, e),
    o = m_bl(h, -i),
    c = m_bm(o, Math.max(s, e.spacing))
      .map((u) =>
        u.map((d) =>
          m_lo(
            {
              x: (d.x0 + d.x1) / 2,
              y: d.y,
            },
            i,
          ),
        ),
      )
      .filter((u) => u.length >= 2);
  return m_wm(c, n).map((u) => u.pts);
}
function m_co(h, e, n = !1) {
  const s = n ? [...h, h[0]] : h;
  if (s.length === 0) return [];
  const i = [s[0]];
  for (let o = 1; o < s.length; o++) distance(s[o - 1], s[o]) < 1e-6 || i.push(...m_Af(s[o - 1], s[o], e));
  return i;
}
function m_b3(h, e, n = !1) {
  const s = m_co(h, e, n),
    i = s.slice(0, -1).reverse(),
    o = s.slice(1);
  return [...s, ...i, ...o];
}
function m_w3(h, e, n = !1) {
  const s = m_co(h, e, n),
    i = [s[0]];
  for (let o = 1; o < s.length; o++) i.push(s[o], s[o - 1], s[o]);
  return i;
}
function m_Jd(h, e, n, s, i = !1) {
  const o = i ? [...h, h[0]] : h,
    l = m_ww(o, n);
  if (l.length < 2) return l;
  const c = e / 2 + s,
    u = [];
  for (let d = 0; d < l.length; d++) {
    const p = l[Math.max(0, d - 1)],
      g = l[Math.min(l.length - 1, d + 1)],
      w = g.x - p.x,
      y = g.y - p.y,
      v = Math.hypot(w, y) || 1,
      j = -y / v,
      k = w / v,
      x = d % 2 === 0 ? 1 : -1;
    u.push({
      x: l[d].x + j * c * x,
      y: l[d].y + k * c * x,
    });
  }
  return u;
}
function m_pb(h, e, n, s) {
  const i = m_gm(h, e);
  return i
    ? [i.outer, ...i.holes].map((l) => {
        const c = l.reduce((d, p, g) => (distance(p, s) < distance(l[d], s) ? g : d), 0),
          u = [...l.slice(c), ...l.slice(0, c)];
        return m_co(u, n, !0);
      })
    : [];
}
function m_y3(h, e, n) {
  const s = m_gm(h, e.underlayInset) ?? h;
  return m_vw(s, e, n, e.angle + 90, e.underlaySpacing, 4, 0);
}
const m_v3 = {
  maxStitch: 7,
  travelMax: 10,
  trimMin: 1.5,
  ties: !0,
  tieLength: 0.8,
  edgeTravelMax: 60,
};
function m_j3(h, e) {
  const n = [];
  let s = e;
  const i = (o) => {
    for (const l of o) {
      const c = m_bw(l, 0.3);
      c.length >= 2 && (n.push(c), (s = c[c.length - 1]));
    }
  };
  switch (h.type) {
    case "fill": {
      const o = h.fill;
      ((o.underlay === "edge" || o.underlay === "edge+tatami") && i(m_pb(h.shape, o.underlayInset, 2.5, s)),
        (o.underlay === "tatami" || o.underlay === "edge+tatami") && i(m_y3(h.shape, o, s)),
        i(m_vw(h.shape, o, s)));
      break;
    }
    case "satin": {
      const o = h.satin;
      (o.underlay === "center" && i(m_g3(h.shape, o, s)),
        o.underlay === "edge" && i(m_pb(h.shape, 0.4, 2, s)),
        o.underlay === "zigzag" &&
          i(
            m_mb(
              h.shape,
              {
                ...o,
                spacing: 2,
                pullComp: -0.3,
              },
              s,
            ),
          ),
        i(m_mb(h.shape, o, s)));
      break;
    }
    case "satinBorder":
    case "zigzag": {
      const o = h.path ?? h.shape.outer,
        l = h.path ? !!h.closed : !0,
        c = h.type === "zigzag" ? Math.max(h.satin.spacing, 1.2) : h.satin.spacing;
      (h.type === "satinBorder" && h.satin.underlay !== "none" && i([m_co(o, 2, l)]),
        i([m_Jd(o, h.satin.width, c, h.type === "zigzag" ? 0 : h.satin.pullComp, l)]));
      break;
    }
    case "running":
    case "triple":
    case "bean": {
      const o = h.path ? [h.path] : [h.shape.outer, ...h.shape.holes],
        l = h.path ? !!h.closed : !0;
      for (const c of o) {
        const u = h.type === "running" ? m_co : h.type === "triple" ? m_b3 : m_w3;
        i([u(c, h.run.stitchLength, l)]);
      }
      break;
    }
  }
  return n;
}
function m_nf(h, e, n) {
  const s = distance(h, e);
  return s < 1e-9
    ? {
        x: h.x + n,
        y: h.y,
      }
    : {
        x: h.x + ((e.x - h.x) * n) / s,
        y: h.y + ((e.y - h.y) * n) / s,
      };
}
function m_ym(h, e, n) {
  if (
    !n ||
    n.type === "running" ||
    n.type === "triple" ||
    n.type === "bean" ||
    n.type === "satinBorder" ||
    n.type === "zigzag"
  )
    return !1;
  const s = Math.max(2, Math.ceil(distance(h, e) / 0.5));
  for (let i = 1; i < s; i++) {
    const o = i / s;
    if (
      !m_wl(
        {
          x: h.x + (e.x - h.x) * o,
          y: h.y + (e.y - h.y) * o,
        },
        n.shape,
      )
    )
      return !1;
  }
  return !0;
}
const m_af = new WeakMap(),
  m_fo = 8,
  m_k3 = (h) => `${Math.floor(h.x / m_fo)},${Math.floor(h.y / m_fo)}`;
function m_S3(h) {
  if (m_af.has(h)) return m_af.get(h);
  if (h.type !== "fill" && h.type !== "satin") return (m_af.set(h, null), null);
  const e = m_gm(h.shape, 0.3) ?? h.shape,
    n = [],
    s = [];
  for (const l of [e.outer, ...e.holes]) {
    if (l.length < 3) continue;
    const c = m_ww([...l, l[0]], 2).slice(0, -1),
      u = n.length;
    c.forEach((d) => {
      (n.push(d), s.push([]));
    });
    for (let d = 0; d < c.length; d++) {
      const p = (d + 1) % c.length,
        g = distance(c[d], c[p]);
      (s[u + d].push({
        to: u + p,
        w: g,
      }),
        s[u + p].push({
          to: u + d,
          w: g,
        }));
    }
  }
  const i = new Map();
  (n.forEach((l, c) => {
    const u = m_k3(l),
      d = i.get(u);
    d ? d.push(c) : i.set(u, [c]);
  }),
    n.forEach((l, c) => {
      for (const u of m_kw(i, l)) {
        if (u <= c) continue;
        const d = distance(l, n[u]);
        d < 2.5 ||
          d > m_fo ||
          (m_ym(l, n[u], h) &&
            (s[c].push({
              to: u,
              w: d * 1.6,
            }),
            s[u].push({
              to: c,
              w: d * 1.6,
            })));
      }
    }));
  const o = {
    nodes: n,
    adj: s,
    grid: i,
  };
  return (m_af.set(h, o), o);
}
function m_kw(h, e) {
  const n = Math.floor(e.x / m_fo),
    s = Math.floor(e.y / m_fo),
    i = [];
  for (let o = -1; o <= 1; o++)
    for (let l = -1; l <= 1; l++) {
      const c = h.get(`${n + o},${s + l}`);
      c && i.push(...c);
    }
  return i;
}
function m_A3(h, e, n, s) {
  if (!n) return null;
  const i = m_S3(n);
  if (!i || i.nodes.length === 0) return null;
  const o = i.nodes.length,
    l = o,
    c = o + 1,
    u = [[], []],
    d = (x, A) => {
      for (const C of m_kw(i.grid, x)) {
        const I = distance(x, i.nodes[C]);
        (I <= 2.2 || (I <= m_fo && m_ym(x, i.nodes[C], n))) &&
          u[A].push({
            to: C,
            w: I * (I <= 2.2 ? 1 : 1.6),
          });
      }
    };
  if ((d(h, 0), d(e, 1), !u[0].length || !u[1].length)) return null;
  const p = new Map();
  for (const x of u[1]) p.set(x.to, x.w);
  const g = new Float64Array(o + 2).fill(1 / 0),
    w = new Int32Array(o + 2).fill(-1);
  g[l] = 0;
  const y = [[0, l]],
    v = (x, A) => {
      y.push([x, A]);
      let C = y.length - 1;
      for (; C > 0;) {
        const I = (C - 1) >> 1;
        if (y[I][0] <= y[C][0]) break;
        (([y[I], y[C]] = [y[C], y[I]]), (C = I));
      }
    },
    j = () => {
      const x = y[0],
        A = y.pop();
      if (y.length) {
        y[0] = A;
        let C = 0;
        for (;;) {
          const I = 2 * C + 1,
            E = I + 1;
          let O = C;
          if (
            (I < y.length && y[I][0] < y[O][0] && (O = I),
            E < y.length && y[E][0] < y[O][0] && (O = E),
            O === C)
          )
            break;
          (([y[O], y[C]] = [y[C], y[O]]), (C = O));
        }
      }
      return x;
    };
  for (; y.length;) {
    const [x, A] = j();
    if (x > g[A]) continue;
    if (A === c || x > s * 1.6) break;
    const C = A === l ? u[0] : i.adj[A];
    for (const I of C) {
      const E = x + I.w;
      E < g[I.to] && ((g[I.to] = E), (w[I.to] = A), v(E, I.to));
    }
    if (A !== l && p.has(A)) {
      const I = x + p.get(A);
      I < g[c] && ((g[c] = I), (w[c] = A), v(I, c));
    }
  }
  if (!isFinite(g[c])) return null;
  const k = [];
  for (let x = w[c]; x !== l && x >= 0; x = w[x]) k.push(i.nodes[x]);
  return (k.reverse(), m_d3([h, ...k, e]) > s ? null : k);
}
function buildPlan(h, e = m_v3) {
  const n = [],
    s = [],
    i = [];
  let o = -1,
    l = null,
    c = !1;
  const u = h.objects.filter((A) => A.visible),
    d = (A, C, I) =>
      n.push({
        x: A.x,
        y: A.y,
        c: C,
        obj: I,
      }),
    p = (A) => {
      if (!e.ties || !l || n.length < 2) return;
      let C = n.length - 2;
      for (; C > 0 && n[C].c === STITCH && distance(n[C], l) < 0.3;) C--;
      const I = l;
      (d(m_nf(I, n[C], e.tieLength * 0.5), STITCH, A),
        d(m_nf(I, n[C], e.tieLength), STITCH, A),
        d(I, STITCH, A));
    },
    g = {
      trims: {
        couleur: 0,
        entreObjets: 0,
        dansObjet: 0,
      },
      travelMm: 0,
      travelSegments: 0,
    },
    w = (A, C) => {
      (l && c && (p(A), d(l, TRIM, A), g.trims[C]++), (c = !1));
    },
    y = (A, C, I) => {
      (d(A, JUMP, I),
        (l = A),
        d(A, STITCH, I),
        e.ties &&
          (d(m_nf(A, C, e.tieLength * 0.5), STITCH, I),
          d(m_nf(A, C, e.tieLength), STITCH, I),
          d(A, STITCH, I)),
        (c = !0));
    },
    v = (A, C) => {
      for (const I of m_Af(l, A, e.maxStitch)) d(I, STITCH, C);
      ((l = A), (c = !0));
    },
    j = (A, C) => {
      g.travelMm += distance(l, A);
      for (const I of m_Af(l, A, 2.5)) d(I, STITCH, C);
      ((l = A), (c = !0));
    },
    k = (A, C, I) => {
      const E = A.pts[0];
      if (!l || !c) y(E, A.pts[1] ?? E, C);
      else {
        const O = distance(l, E);
        if (!(O < 1e-6))
          if (I && O <= e.travelMax && m_ym(l, E, A.inside)) v(E, C);
          else if (O < e.trimMin && I) v(E, C);
          else {
            const B = I ? m_A3(l, E, A.inside, e.edgeTravelMax) : null;
            if (B) {
              g.travelSegments++;
              for (const _ of m_bw(B, 1.5)) j(_, C);
              j(E, C);
            } else (w(C, I ? "dansObjet" : "entreObjets"), y(E, A.pts[1] ?? E, C));
          }
      }
      for (let O = 1; O < A.pts.length; O++) v(A.pts[O], C);
    },
    x = (A, C, I = !1) => {
      (o === A && !I) ||
        (o !== -1 &&
          (w(C, "couleur"),
          d(
            l ?? {
              x: 0,
              y: 0,
            },
            COLOR_CHANGE,
            C,
          )),
        s.push(h.threads[A]),
        (o = A),
        (c = !1));
    };
  return (
    u.forEach((A, C) => {
      const I = n.length;
      if (A.type === "applique") {
        const E = A.shape.outer;
        (x(A.color, C),
          k(
            {
              pts: m_co(E, 2.5, !0),
            },
            C,
            !1,
          ),
          x(A.color, C, !0),
          k(
            {
              pts: m_Jd(E, 1.5, 1.6, 0, !0),
            },
            C,
            !1,
          ),
          x(A.color, C, !0),
          k(
            {
              pts: m_Jd(E, Math.max(2.5, A.satin.width), A.satin.spacing, A.satin.pullComp, !0),
            },
            C,
            !1,
          ));
      } else {
        x(A.color, C);
        const E = m_j3(A, l ?? m_q3(A));
        let O = !0;
        for (const B of E)
          (k(
            {
              pts: B,
              inside: A,
            },
            C,
            !O,
          ),
            (O = !1));
      }
      i.push({
        objectId: A.id,
        start: I,
        end: n.length,
        color: o,
      });
    }),
    l && c && p(u.length - 1),
    d(
      l ?? {
        x: 0,
        y: 0,
      },
      END,
    ),
    {
      stitches: n,
      threads: s,
      objectRanges: i,
      diag: g,
    }
  );
}
function m_q3(h) {
  return (
    (h.path ?? h.shape.outer)[0] ?? {
      x: 0,
      y: 0,
    }
  );
}
function computeStats(h, e = 850) {
  let n = 0,
    s = 0,
    i = 0,
    o = 0,
    l = 0,
    c = 0,
    u = 1 / 0,
    d = 1 / 0,
    p = -1 / 0,
    g = -1 / 0,
    w = null;
  for (const v of h.stitches) {
    if (v.c === STITCH) {
      if (
        (n++,
        v.x < u && (u = v.x),
        v.y < d && (d = v.y),
        v.x > p && (p = v.x),
        v.y > g && (g = v.y),
        w && w.c === STITCH)
      ) {
        const j = Math.hypot(v.x - w.x, v.y - w.y);
        ((c += j), j > l && (l = j));
      }
    } else v.c === JUMP ? s++ : v.c === TRIM ? i++ : v.c === COLOR_CHANGE && o++;
    w = v;
  }
  n === 0 && (u = d = p = g = 0);
  const y = n / e + (i * 10) / 60 + (o * 40) / 60;
  return {
    stitches: n,
    jumps: s,
    trims: i,
    colorChanges: o,
    widthMm: p - u,
    heightMm: g - d,
    minX: u,
    minY: d,
    maxX: p,
    maxY: g,
    maxStitchMm: l,
    threadLengthM: (c * 1.1) / 1e3,
    estMinutes: y,
  };
}
const m_jm = [
    null,
    [925564, "Prussian Blue", "1"],
    [677283, "Blue", "2"],
    [34679, "Teal Green", "3"],
    [4942767, "Cornflower Blue", "4"],
    [15537951, "Red", "5"],
    [13720576, "Reddish Brown", "6"],
    [9516695, "Magenta", "7"],
    [14981835, "Light Lilac", "8"],
    [9527212, "Lilac", "9"],
    [10409597, "Mint Green", "10"],
    [15247616, "Deep Gold", "11"],
    [16693813, "Orange", "12"],
    [16776960, "Yellow", "13"],
    [7388191, "Lime Green", "14"],
    [12228608, "Brass", "15"],
    [11053224, "Silver", "16"],
    [8220416, "Russet Brown", "17"],
    [16777139, "Cream Brown", "18"],
    [5199190, "Pewter", "19"],
    [0, "Black", "20"],
    [736657, "Ultramarine", "21"],
    [7799158, "Royal Purple", "22"],
    [2699571, "Dark Gray", "23"],
    [2757377, "Dark Brown", "24"],
    [16140938, "Deep Rose", "25"],
    [11695652, "Light Brown", "26"],
    [16563141, "Salmon Pink", "27"],
    [16660239, "Vermilion", "28"],
    [15790320, "White", "29"],
    [6954122, "Violet", "30"],
    [11066820, "Seacrest", "31"],
    [2458811, "Sky Blue", "32"],
    [16692035, "Pumpkin", "33"],
    [16773995, "Cream Yellow", "34"],
    [13674080, "Khaki", "35"],
    [13718528, "Clay Brown", "36"],
    [6732361, "Leaf Green", "37"],
    [1264198, "Peacock Blue", "38"],
    [8882055, "Gray", "39"],
    [14208198, "Warm Gray", "40"],
    [4412935, "Dark Olive", "41"],
    [16636382, "Flesh Pink", "42"],
    [16356284, "Pink", "43"],
    [14370, "Deep Green", "44"],
    [11710420, "Lavender", "45"],
    [6843056, "Wisteria Violet", "46"],
    [15721401, "Beige", "47"],
    [16201830, "Carmine", "48"],
    [11881316, "Amber Red", "49"],
    [1256218, "Olive Green", "50"],
    [13042006, "Dark Fuchsia", "51"],
    [16686642, "Tangerine", "52"],
    [11067115, "Light Blue", "53"],
    [26430, "Emerald Green", "54"],
    [5122448, "Purple", "55"],
    [3112480, "Moss Green", "56"],
    [16764108, "Flesh Pink", "57"],
    [16767249, "Harvest Gold", "58"],
    [613286, "Electric Blue", "59"],
    [15792496, "Lemon Yellow", "60"],
    [14938971, "Fresh Green", "61"],
    [16750848, "Orange", "62"],
    [16773261, "Cream Yellow", "63"],
    [16763080, "Applique", "64"],
  ],
  m_gb = [
    0, 0, 0, 0, 0, 0, 240, 255, 255, 255, 255, 15, 8, 0, 0, 0, 0, 16, 4, 0, 0, 0, 0, 32, 2, 0, 0, 0, 0, 64, 2,
    0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0,
    64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0,
    0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0,
    64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0,
    0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0, 64, 2, 0, 0, 0, 0,
    64, 2, 0, 0, 0, 0, 64, 4, 0, 0, 0, 0, 32, 8, 0, 0, 0, 0, 16, 240, 255, 255, 255, 255, 15, 0, 0, 0, 0, 0,
    0,
  ];
function m_js(h) {
  const e = Math.floor(h),
    n = h - e;
  return n > 0.5 ? e + 1 : n < 0.5 || e % 2 === 0 ? e : e + 1;
}
const m_ja = (h) => Math.trunc(h);
function preparePesStitches(h, e, n, s) {
  const i = [],
    o = [];
  let l = !0,
    c = 0,
    u = 0,
    d = -1;
  const p = (v, j = c, k = u) => i.push([j, k, v]),
    g = () => {
      (d++, o.push(h.threads[d] ?? h.threads[h.threads.length - 1]), d !== 0 && p(COLOR_CHANGE), (l = !0));
    },
    w = (v, j, k, x) => {
      const A = v - c,
        C = j - u;
      if (Math.abs(A) > k || Math.abs(C) > k) {
        const I = Math.ceil(Math.abs(A / k)),
          E = Math.ceil(Math.abs(C / k)),
          O = I > E ? I : E,
          B = A / O,
          _ = C / O;
        let X = c,
          K = u;
        for (let ie = 1; ie < O; ie++) ((X += B), (K += _), i.push([X, K, x]), (c = X), (u = K));
      }
    };
  let y = !1;
  for (const v of h.stitches) {
    const j = m_js(v.x * 10),
      k = m_js(v.y * 10);
    if (v.c === STITCH)
      l
        ? (d === -1 && g(),
          (l = !1),
          w(j, k, e, JUMP),
          s && (c !== j || u !== k) && (p(JUMP, j, k), (c = j), (u = k)),
          p(STITCH, j, k),
          (c = j),
          (u = k))
        : (w(j, k, n, JUMP), p(STITCH, j, k), (c = j), (u = k));
    else if (v.c === TRIM) l || (p(TRIM), (l = !0));
    else if (v.c === JUMP) (w(j, k, e, JUMP), p(JUMP, j, k), (c = j), (u = k));
    else if (v.c === COLOR_CHANGE) g();
    else if (v.c === END) {
      (p(END), (l = !0), (y = !0));
      break;
    }
  }
  return (
    y || p(END),
    {
      st: i,
      threads: o,
    }
  );
}
class ByteWriter {
  a = [];
  get pos() {
    return this.a.length;
  }
  u8(e) {
    this.a.push(e & 255);
  }
  u16(e) {
    (this.u8(e), this.u8(e >> 8));
  }
  u24(e) {
    (this.u8(e), this.u8(e >> 8), this.u8(e >> 16));
  }
  u32(e) {
    (this.u8(e), this.u8(e >> 8), this.u8(e >> 16), this.u8(e >>> 24));
  }
  f32(e) {
    const n = new DataView(new ArrayBuffer(4));
    n.setFloat32(0, e, !0);
    for (let s = 0; s < 4; s++) this.u8(n.getUint8(s));
  }
  str(e) {
    for (const n of new TextEncoder().encode(e)) this.u8(n);
  }
  bytes(e) {
    for (const n of e) this.u8(n);
  }
  put16(e, n) {
    ((this.a[e] = n & 255), (this.a[e + 1] = (n >> 8) & 255));
  }
  put24(e, n) {
    ((this.a[e] = n & 255), (this.a[e + 1] = (n >> 8) & 255), (this.a[e + 2] = (n >> 16) & 255));
  }
  put32(e, n) {
    (this.put24(e, n), (this.a[e + 3] = (n >>> 24) & 255));
  }
  out() {
    return new Uint8Array(this.a);
  }
}
const m_Qi = (h) => parseInt(h.replace("#", ""), 16) & 16777215;
function m_C3(h, e, n, s, i, o) {
  const l = m_js((h + s) / 2),
    c = h - s,
    u = e - i,
    d = n - o;
  return (((512 + l) * c * c) >> 8) + 4 * u * u + (((767 - l) * d * d) >> 8);
}
function m_xf(h, e) {
  const n = (h >> 16) & 255,
    s = (h >> 8) & 255,
    i = h & 255;
  let o = null,
    l = 1 / 0;
  return (
    e.forEach((c, u) => {
      if (c == null) return;
      const d = m_C3(n, s, i, (c >> 16) & 255, (c >> 8) & 255, c & 255);
      d <= l && ((l = d), (o = u));
    }),
    o
  );
}
const m_Sw = () => m_jm.map((h) => (h ? h[0] : null));
function m_Am(h) {
  let e = 1 / 0,
    n = 1 / 0,
    s = -1 / 0,
    i = -1 / 0;
  for (const o of h)
    (o[0] > s && (s = o[0]), o[0] < e && (e = o[0]), o[1] > i && (i = o[1]), o[1] < n && (n = o[1]));
  return [e, n, s, i];
}
function m_ai(h, e, n, s = 0) {
  if (!n && -64 < e && e < 63) h.u8(e & 127);
  else {
    let i = e & 4095;
    ((i |= 32768), (i |= s << 8), h.u8((i >> 8) & 255), h.u8(i & 255));
  }
}
function m_T3(h, e) {
  let n = !0,
    s = !0,
    i = !0,
    o = 0,
    l = 0;
  for (const [c, u, d] of e) {
    const p = m_ja(m_js(c - o)),
      g = m_ja(m_js(u - l));
    if (((o += p), (l += g), d === STITCH))
      (s && (p !== 0 && g !== 0 && (m_ai(h, 0, !1), m_ai(h, 0, !1)), (s = !1)),
        m_ai(h, p, !1),
        m_ai(h, g, !1));
    else if (d === JUMP) {
      s = !0;
      const w = i ? 16 : 32;
      (m_ai(h, p, !0, w), m_ai(h, g, !0, w));
    } else if (d === COLOR_CHANGE)
      (s && (m_ai(h, 0, !1), m_ai(h, 0, !1), (s = !1)), h.bytes([254, 176, n ? 2 : 1]), (n = !n));
    else if (d === END) {
      h.u8(255);
      break;
    }
    i = !1;
  }
}
function m_M3(h, e, n, s) {
  let i = n * s + Math.trunc(e / 8);
  (i < 0 && (i += h.length), !(i < 0 || i >= h.length) && (h[i] |= 1 << (((e % 8) + 8) % 8)));
}
function m_bb(h, e, n, s, i = 5) {
  const [o, l, c, u] = h;
  let d = c - o,
    p = u - l;
  const g = s * 8,
    w = n.length / s;
  (d === 0 && (d = 1), p === 0 && (p = 1));
  const y = Math.min((g - i) / d, (w - i) / p),
    v = (c + o) / 2,
    j = (u + l) / 2,
    k = -v * y + g / 2,
    x = -j * y + w / 2;
  for (const A of e) m_M3(n, Math.floor(A[0] * y + k), Math.floor(A[1] * y + x), s);
}
function writePec(h, e, n, s) {
  const i = m_Am(e);
  (h.str("LA:" + s.slice(0, 8).padEnd(16, " ") + "\r"),
    h.bytes([32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 255, 0]),
    h.u8(48 / 8),
    h.u8(38));
  const o = m_Sw(),
    l = new Array(o.length).fill(null),
    c = [];
  for (const x of n) {
    const A = m_Qi(x.rgb);
    c.includes(A) || c.push(A);
  }
  for (const x of c) {
    const A = m_xf(x, o);
    if (A == null) break;
    ((o[A] = null), (l[A] = x));
  }
  const u = n.map((x) => m_xf(m_Qi(x.rgb), l)),
    d = u.length;
  if (d !== 0) {
    if ((h.bytes(new Array(12).fill(32)), d - 1 >= 255))
      throw new Error("Trop de changements de couleur pour le format PEC (max 255).");
    (h.u8(d - 1), h.bytes(u));
  } else h.bytes([32, 32, 32, 32, 100, 32, 0, 32, 0, 32, 32, 32, 255]);
  for (let x = d; x < 463; x++) h.u8(32);
  const p = d !== 0 ? [d - 1, ...u] : [],
    g = h.pos;
  (h.bytes([0, 0]),
    h.u24(0),
    h.bytes([49, 255, 240]),
    h.u16(m_js(i[2] - i[0])),
    h.u16(m_js(i[3] - i[1])),
    h.u16(480),
    h.u16(432),
    m_T3(h, e),
    h.put24(g + 2, h.pos - g));
  const w = m_gb.slice();
  let y = [];
  const v = () => {
    (y.length && m_bb(i, y, w, 6, 4), (y = []));
  };
  for (const x of e) x[2] === STITCH ? y.push(x) : v();
  (v(), h.bytes(w));
  let j = 0;
  const k = [];
  (e.forEach((x, A) => {
    x[2] === COLOR_CHANGE && (k.push(e.slice(j, A + 1)), (j = A + 1));
  }),
    j !== e.length && k.push(e.slice(j)));
  for (const x of k) {
    const A = m_gb.slice();
    (m_bb(
      i,
      x.filter((C) => C[2] === STITCH),
      A,
      6,
    ),
      h.bytes(A));
  }
  return p;
}
function writePesEmbOne(h, e, n, s) {
  const i = m_Am(e),
    o = (i[2] + i[0]) / 2,
    l = (i[3] + i[1]) / 2,
    c = i[0] - o,
    u = i[1] - l,
    d = i[2] - o,
    p = i[3] - l;
  (h.u16(7), h.str("CEmbOne"));
  const g = d - c,
    w = p - u;
  for (let le = 0; le < 8; le++) h.u16(0);
  const y = 350 + 1300 / 2 - g / 2,
    v = 100 + w + 1800 / 2 - w / 2;
  (h.f32(1),
    h.f32(0),
    h.f32(0),
    h.f32(1),
    h.f32(y),
    h.f32(v),
    h.u16(1),
    h.u16(0),
    h.u16(0),
    h.u16(m_ja(g)),
    h.u16(m_ja(w)),
    h.bytes([0, 0, 0, 0, 0, 0, 0, 0]));
  const j = h.pos;
  (h.u16(0), h.u16(65535), h.u16(0), h.u16(7), h.str("CSewSeg"));
  const k = c + o,
    x = p + l;
  let A = 0,
    C = -1,
    I = -1;
  const E = [];
  let O = 0;
  const B = (le) =>
    n[le] ?? {
      rgb: "#000000",
    };
  let _ = m_xf(m_Qi(B(O++).rgb), s),
    X = 0,
    K = 0;
  const ie = [];
  let ne = 0,
    ge = -1;
  (e.forEach((le, oe) => {
    if (le[2] === ge || ge === -1) {
      ge = le[2];
      return;
    }
    ((ge = le[2]), ie.push(e.slice(ne, oe)), (ne = oe));
  }),
    ie.push(e.slice(ne)));
  for (const le of ie) {
    const oe = le[0][2];
    let Y = [],
      Z;
    if (oe === JUMP) {
      const te = le[le.length - 1];
      ((Y = [
        [X - k, K - x],
        [te[0] - k, te[1] - x],
      ]),
        (Z = 1));
    } else if (oe === COLOR_CHANGE) {
      _ = m_xf(m_Qi(B(O++).rgb), s);
      continue;
    } else if (oe === STITCH) {
      for (const te of le) ((X = te[0]), (K = te[1]), Y.push([X - k, K - x]));
      Z = 0;
    } else continue;
    (I !== -1 && h.u16(32771),
      (I = Z),
      C !== _ && (E.push([A, _]), (C = _)),
      h.u16(I),
      h.u16(_),
      h.u16(Y.length));
    for (const [te, be] of Y) (h.u16(m_ja(te)), h.u16(m_ja(be)));
    A++;
  }
  h.u16(E.length);
  for (const [le, oe] of E) (h.u16(le), h.u16(oe));
  return (h.put16(j, A), h.u16(0), h.u16(0), E);
}
function writePES1(h, e = "StitchStudio") {
  const { st: n, threads: s } = preparePesStitches(h, 2047, 2047, !0),
    i = new ByteWriter();
  i.str("#PES0001");
  const o = i.pos;
  i.u32(0);
  const l = n.length > 0;
  return (
    i.u16(1),
    i.u16(1),
    i.u16(l ? 1 : 0),
    l ? (i.u16(65535), i.u16(0), writePesEmbOne(i, n, s, m_Sw())) : (i.u16(0), i.u16(0)),
    i.put32(o, i.pos),
    writePec(i, n, s, e),
    i.out()
  );
}
function m_gs(h, e) {
  if (e == null || e === "") {
    h.u8(0);
    return;
  }
  const n = e.slice(0, 255);
  (h.u8(n.length), h.str(n));
}
function writePES6(h, e = "StitchStudio") {
  const { st: n, threads: s } = preparePesStitches(h, 2047, 2047, !0),
    i = new ByteWriter();
  i.str("#PES0060");
  const o = i.pos;
  i.u32(0);
  const l = (u) => {
    (i.u16(1),
      i.str("02"),
      m_gs(i, e),
      m_gs(i, null),
      m_gs(i, null),
      m_gs(i, null),
      m_gs(i, null),
      i.u16(0),
      i.u16(0),
      i.u16(100),
      i.u16(100),
      i.u16(0),
      i.u16(200),
      i.u16(200),
      i.u16(100),
      i.u16(100),
      i.u16(100),
      i.u16(7),
      i.u16(19),
      i.u16(1),
      i.u16(1),
      i.u16(0),
      i.u16(100),
      i.u16(1),
      i.u16(0),
      i.u8(0),
      i.f32(1),
      i.f32(0),
      i.f32(0),
      i.f32(1),
      i.f32(0),
      i.f32(0),
      i.u16(0),
      i.u16(0),
      i.u16(0),
      i.u16(s.length));
    for (const d of s) {
      m_gs(i, d.code);
      const p = m_Qi(d.rgb);
      (i.u8((p >> 16) & 255),
        i.u8((p >> 8) & 255),
        i.u8(p & 255),
        i.u8(0),
        i.u32(10),
        m_gs(i, d.name),
        m_gs(i, d.brand),
        m_gs(i, null));
    }
    i.u16(u);
  };
  if (n.length === 0) (l(0), i.u16(0), i.u16(0));
  else {
    (l(1), i.u16(65535), i.u16(0));
    const u = writePesEmbOne(
      i,
      n,
      s,
      s.map((d) => m_Qi(d.rgb)),
    );
    (i.u32(0), i.u32(0));
    for (let d = 0; d < u.length; d++) (i.u32(d), i.u32(0));
  }
  i.put32(o, i.pos);
  const c = writePec(i, n, s, e);
  i.bytes(c);
  for (let u = c.length; u < 128; u++) i.u8(32);
  for (let u = 0; u < s.length; u++) for (let d = 0; d < 144; d++) i.u8(0);
  for (const u of s) i.u24(m_Qi(u.rgb));
  return (i.u16(0), i.out());
}
const m_At = (h) => 1 << h;
function dstEncodeRecord(h, e, n) {
  e = -e;
  let s = 0,
    i = 0,
    o = 0;
  if ((n === JUMP && (o += m_At(7)), n === STITCH || n === JUMP)) {
    if (
      ((o += m_At(0) + m_At(1)),
      h > 40 && ((o += m_At(2)), (h -= 81)),
      h < -40 && ((o += m_At(3)), (h += 81)),
      h > 13 && ((i += m_At(2)), (h -= 27)),
      h < -13 && ((i += m_At(3)), (h += 27)),
      h > 4 && ((s += m_At(2)), (h -= 9)),
      h < -4 && ((s += m_At(3)), (h += 9)),
      h > 1 && ((i += m_At(0)), (h -= 3)),
      h < -1 && ((i += m_At(1)), (h += 3)),
      h > 0 && ((s += m_At(0)), (h -= 1)),
      h < 0 && ((s += m_At(1)), (h += 1)),
      h !== 0)
    )
      throw new Error("DST : déplacement X trop long");
    if (
      (e > 40 && ((o += m_At(5)), (e -= 81)),
      e < -40 && ((o += m_At(4)), (e += 81)),
      e > 13 && ((i += m_At(5)), (e -= 27)),
      e < -13 && ((i += m_At(4)), (e += 27)),
      e > 4 && ((s += m_At(5)), (e -= 9)),
      e < -4 && ((s += m_At(4)), (e += 9)),
      e > 1 && ((i += m_At(7)), (e -= 3)),
      e < -1 && ((i += m_At(6)), (e += 3)),
      e > 0 && ((s += m_At(7)), (e -= 1)),
      e < 0 && ((s += m_At(6)), (e += 1)),
      e !== 0)
    )
      throw new Error("DST : déplacement Y trop long");
  } else n === COLOR_CHANGE ? (o = 195) : n === END && (o = 243);
  return [s, i, o];
}
const m_za = (h, e) => String(m_ja(h)).padStart(e, " ");
function writeDST(h, e = "StitchStudio") {
  const { st: n } = preparePesStitches(h, 121, 121, !1),
    s = new ByteWriter(),
    i = m_Am(n),
    o = n.filter((p) => p[2] === COLOR_CHANGE).length;
  (s.str("LA:" + e.padEnd(16, " ") + "\r"),
    s.str("ST:" + m_za(n.length, 7) + "\r"),
    s.str("CO:" + m_za(o, 3) + "\r"),
    s.str("+X:" + m_za(Math.abs(i[2]), 5) + "\r"),
    s.str("-X:" + m_za(Math.abs(i[0]), 5) + "\r"),
    s.str("+Y:" + m_za(Math.abs(i[3]), 5) + "\r"),
    s.str("-Y:" + m_za(Math.abs(i[1]), 5) + "\r"));
  let l = 0,
    c = 0;
  for (
    n.length && ((l = m_ja(n[n.length - 1][0])), (c = -m_ja(n[n.length - 1][1]))),
      s.str((l >= 0 ? "AX:+" : "AX:-") + m_za(Math.abs(l), 5) + "\r"),
      s.str((c >= 0 ? "AY:+" : "AY:-") + m_za(Math.abs(c), 5) + "\r"),
      s.str("MX:+" + m_za(0, 5) + "\r"),
      s.str("MY:+" + m_za(0, 5) + "\r"),
      s.str("PD:******\r"),
      s.u8(26);
    s.pos < 512;
  )
    s.u8(32);
  let u = 0,
    d = 0;
  for (const [p, g, w] of n) {
    const y = m_ja(m_js(p - u)),
      v = m_ja(m_js(g - d));
    if (((u += y), (d += v), w === TRIM)) {
      let j = -4;
      (s.bytes(dstEncodeRecord(-j / 2, -j / 2, JUMP)),
        s.bytes(dstEncodeRecord(j, j, JUMP)),
        (j = -j),
        s.bytes(dstEncodeRecord(j / 2, j / 2, JUMP)));
    } else s.bytes(dstEncodeRecord(y, v, w));
  }
  return s.out();
}
const MACHINES = [
    {
      id: "brother-xe1",
      brand: "Brother",
      model: "Stellaire Innov-is XE1",
      formats: ["PES"],
      maxFieldMm: {
        w: 241.3,
        h: 355.6,
      },
      maxStitches: null,
      maxColors: null,
      hoops: [
        {
          id: "sa439s",
          name: "Cadre 13 × 18 cm (SA439S, 5″ × 7″)",
          widthMm: 130,
          heightMm: 180,
          source:
            "Fiche technique Brother Stellaire XE1 : cadre 5″ × 7″ (SA439S) fourni ; dimensions métriques 130 × 180 mm à confirmer dans le manuel.",
          confirmed: !1,
        },
        {
          id: "sa449s",
          name: "Cadre 24 × 36 cm (SA449S, 9,5″ × 14″)",
          widthMm: 241.3,
          heightMm: 355.6,
          source: "Fiche technique Brother Stellaire XE1 : cadre 9,5″ × 14″ (SA449S) fourni.",
          confirmed: !1,
        },
      ],
      status: "vérifié",
      sources: ["https://cdn.shopify.com/s/files/1/0431/1577/4109/files/Stellaire_XE1_Spec_Sheet.pdf"],
      notes:
        "Formats lus autres que PES (DST, PHC…) à confirmer dans le manuel avant de les proposer. Limite de points non publiée sur la fiche.",
    },
    ...["Stellaire XJ1", "Stellaire XE2", "Stellaire XJ2", "Innov-is (gamme)", "PR (gamme)"].map((h) => ({
      id: "brother-" + h.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
      brand: "Brother",
      model: h,
      formats: [],
      maxFieldMm: null,
      maxStitches: null,
      maxColors: null,
      hoops: [],
      status: "à compléter",
      sources: [],
      notes: "Cadres et limites à saisir depuis la fiche officielle.",
    })),
    ...["Janome", "Bernina", "Pfaff"].map((h) => ({
      id: h.toLowerCase(),
      brand: h,
      model: "(modèle à choisir)",
      formats: [],
      maxFieldMm: null,
      maxStitches: null,
      maxColors: null,
      hoops: [],
      status: "à compléter",
      sources: [],
      notes: "Format natif (JEF, EXP/ART, VP3) et cadres à saisir.",
    })),
  ],
  FORMAT_LIMITS = {
    PES: {
      maxColorChanges: 254,
    },
  },
  QC_THRESHOLDS = {
    machineMaxStitch: 12.1,
    satinMaxStitch: 7,
    densityWarn: 10,
    densityError: 18,
    minDetailMm2: 3,
    minSatinWidth: 1,
    longJump: 25,
    minPullComp: 0.15,
    maxPullComp: 0.8,
    densityBlock: 30,
    hoopMargin: 3,
    shortStitch: 0.3,
    longStitchWarn: 8,
    pileRadius: 0.5,
    pileCount: 10,
    underlayFillArea: 400,
    underlaySatinWidth: 2.5,
    overlapShare: 0.4,
  };
function m_E3(h, e, n, s) {
  const i = (d, p, g) => (p.x - d.x) * (g.y - d.y) - (p.y - d.y) * (g.x - d.x),
    o = i(h, e, n),
    l = i(h, e, s),
    c = i(n, s, h),
    u = i(n, s, e);
  return o * l < 0 && c * u < 0;
}
function runQualityChecks(h, e, n, s) {
  const i = [],
    o = computeStats(e);
  if (
    ((!n || n.status !== "vérifié") &&
      i.push({
        level: "error",
        code: "machine.unverified",
        message: "Profil de machine incomplet : export bloqué tant que ses limites ne sont pas renseignées.",
      }),
    s)
  ) {
    const V = o.widthMm <= s.widthMm && o.heightMm <= s.heightMm,
      fe = o.heightMm <= s.widthMm && o.widthMm <= s.heightMm;
    V ||
      i.push({
        level: "error",
        code: "hoop.overflow",
        value: Math.max(o.widthMm - s.widthMm, o.heightMm - s.heightMm),
        message:
          `Le motif (${o.widthMm.toFixed(1)} × ${o.heightMm.toFixed(1)} mm) dépasse le cadre ${s.name} (${s.widthMm} × ${s.heightMm} mm).` +
          (fe ? " Il tiendrait après une rotation de 90°." : ""),
      });
    const ce = Math.min(s.widthMm - o.widthMm, s.heightMm - o.heightMm) / 2;
    (V &&
      ce < QC_THRESHOLDS.hoopMargin &&
      i.push({
        level: "warning",
        code: "hoop.margin",
        value: ce,
        message: `Marge de ${ce.toFixed(1)} mm seulement au bord du cadre (${QC_THRESHOLDS.hoopMargin} mm conseillés) : le pied presseur peut toucher le cadre.`,
      }),
      s.confirmed ||
        i.push({
          level: "info",
          code: "hoop.unconfirmed",
          message: `Dimensions métriques du ${s.name} à confirmer dans le manuel de la machine.`,
        }));
  }
  const l = [];
  let c = e.stitches[0];
  for (const V of e.stitches)
    (V.c === STITCH &&
      c &&
      c.c === STITCH &&
      Math.hypot(V.x - c.x, V.y - c.y) > QC_THRESHOLDS.machineMaxStitch &&
      l.push({
        x: V.x,
        y: V.y,
      }),
      (c = V));
  l.length &&
    i.push({
      level: "error",
      code: "stitch.tooLong",
      value: l.length,
      at: l.slice(0, 50),
      message: `${l.length} point(s) dépassent ${QC_THRESHOLDS.machineMaxStitch} mm.`,
    });
  const u = [];
  for (const V of e.objectRanges) {
    const fe = h.objects.find((F) => F.id === V.objectId);
    if (!fe || (fe.type !== "satin" && fe.type !== "satinBorder")) continue;
    let ce = 0;
    for (let F = V.start + 1; F < V.end; F++) {
      const $ = e.stitches[F - 1],
        ue = e.stitches[F];
      $.c === STITCH && ue.c === STITCH && (ce = Math.max(ce, Math.hypot(ue.x - $.x, ue.y - $.y)));
    }
    ce > QC_THRESHOLDS.satinMaxStitch && u.push(fe.id);
  }
  u.length &&
    i.push({
      level: "warning",
      code: "satin.tooWide",
      objects: u,
      message: `${u.length} zone(s) satin ont des points de plus de ${QC_THRESHOLDS.satinMaxStitch} mm : passer en tatami ou réduire la largeur.`,
    });
  const d = new Map();
  for (const V of e.stitches) {
    if (V.c !== STITCH) continue;
    const fe = Math.floor(V.x) * 100003 + Math.floor(V.y);
    d.set(fe, (d.get(fe) ?? 0) + 1);
  }
  let p = 0,
    g = 0,
    w = 0;
  const y = [];
  for (const [V, fe] of d) {
    if ((fe > p && (p = fe), fe > QC_THRESHOLDS.densityWarn && (g++, y.length < 50))) {
      const ce = Math.round(V / 100003);
      y.push({
        x: ce + 0.5,
        y: V - ce * 100003 + 0.5,
      });
    }
    fe > QC_THRESHOLDS.densityError && w++;
  }
  p > QC_THRESHOLDS.densityBlock
    ? i.push({
        level: "error",
        code: "density.block",
        value: p,
        at: y,
        message: `Densité de ${p} pénétrations/mm² (limite ${QC_THRESHOLDS.densityBlock}) : risque de casse d'aiguille, export bloqué.`,
      })
    : w > 0
      ? i.push({
          level: "warning",
          code: "density.high",
          value: p,
          at: y,
          message: `Densité très élevée : jusqu'à ${p} pénétrations/mm² (${w} mm² au-dessus de ${QC_THRESHOLDS.densityError}). Risque d'accumulation de fil et de casse d'aiguille.`,
        })
      : g > 0 &&
        i.push({
          level: "info",
          code: "density.local",
          value: p,
          at: y,
          message: `${g} mm² au-dessus de ${QC_THRESHOLDS.densityWarn} pénétrations/mm² (souvent points d'arrêt ou jonctions).`,
        });
  let v = 0;
  for (let V = 1; V < e.stitches.length; V++) {
    const fe = e.stitches[V - 1],
      ce = e.stitches[V];
    fe.c === STITCH && ce.c === STITCH && Math.hypot(fe.x - ce.x, fe.y - ce.y) < 0.1 && v++;
  }
  v > Math.max(5, o.stitches * 0.01) &&
    i.push({
      level: "warning",
      code: "stitch.duplicate",
      value: v,
      message: `${v} points superposés consécutifs.`,
    });
  const j = [];
  for (const V of h.objects) {
    const fe = V.path ? [] : [V.shape.outer, ...V.shape.holes];
    for (const ce of fe) {
      if (ce.length < 3) {
        j.push(V.id);
        break;
      }
      let F = !1;
      const $ = ce.length;
      if ($ <= 400)
        for (let ue = 0; ue < $ && !F; ue++)
          for (let ae = ue + 2; ae < $ && !F; ae++)
            (ue === 0 && ae === $ - 1) ||
              (m_E3(ce[ue], ce[(ue + 1) % $], ce[ae], ce[(ae + 1) % $]) && (F = !0));
      if (F) {
        j.push(V.id);
        break;
      }
    }
  }
  j.length &&
    i.push({
      level: "warning",
      code: "contour.invalid",
      objects: j,
      message: `${j.length} contour(s) non fermés ou qui se croisent : le remplissage peut être irrégulier.`,
    });
  const k = [];
  for (const V of h.objects) {
    if (V.path) continue;
    (m_ao(V.shape) < QC_THRESHOLDS.minDetailMm2 ||
      (V.type === "satin" && m_Qd(V.shape) * 2 < QC_THRESHOLDS.minSatinWidth)) &&
      k.push(V.id);
  }
  k.length &&
    i.push({
      level: "warning",
      code: "detail.small",
      objects: k,
      message: `${k.length} détail(s) trop petits pour être brodés proprement (< ${QC_THRESHOLDS.minDetailMm2} mm²).`,
    });
  let x = 0,
    A = e.stitches[0];
  for (const V of e.stitches)
    (V.c === JUMP && A && Math.hypot(V.x - A.x, V.y - A.y) > QC_THRESHOLDS.longJump && x++, (A = V));
  (o.trims > Math.max(30, h.objects.length * 3) &&
    i.push({
      level: "warning",
      code: "jump.many",
      value: o.trims,
      message: `${o.trims} coupes de fil : envisager de regrouper ou réordonner les objets.`,
    }),
    x &&
      i.push({
        level: "info",
        code: "jump.long",
        value: x,
        message: `${x} déplacement(s) de plus de ${QC_THRESHOLDS.longJump} mm (coupés automatiquement).`,
      }));
  let C = 0;
  for (let V = 1; V < e.threads.length; V++) e.threads[V].rgb === e.threads[V - 1].rgb && C++;
  const I = h.objects.filter((V) => V.type === "applique").length * 2;
  C > I &&
    i.push({
      level: "warning",
      code: "color.redundant",
      value: C - I,
      message: `${C - I} changement(s) de fil vers la même couleur.`,
    });
  const E = new Map();
  e.threads.forEach((V) => E.set(V.rgb, (E.get(V.rgb) ?? 0) + 1));
  const O = [...E.values()].filter((V) => V > 1).length;
  (O > 0 &&
    C === 0 &&
    i.push({
      level: "info",
      code: "color.regroup",
      value: O,
      message: `${O} couleur(s) reviennent plusieurs fois : regrouper réduirait les changements de bobine si l'empilement le permet.`,
    }),
    o.colorChanges > FORMAT_LIMITS.PES.maxColorChanges &&
      i.push({
        level: "error",
        code: "color.pesLimit",
        message: `Le format PES accepte au plus ${FORMAT_LIMITS.PES.maxColorChanges} changements de couleur.`,
      }));
  const B = h.objects
    .filter(
      (V) =>
        (V.type === "fill" && V.fill.pullComp < QC_THRESHOLDS.minPullComp) ||
        (V.type === "satin" && V.satin.pullComp < QC_THRESHOLDS.minPullComp),
    )
    .map((V) => V.id);
  B.length &&
    i.push({
      level: "warning",
      code: "pullcomp.low",
      objects: B,
      message: `${B.length} objet(s) avec une compensation de tirage < ${QC_THRESHOLDS.minPullComp} mm : risque de jours entre les zones.`,
    });
  let _ = 0,
    X = 0;
  const K = [],
    ie = new Set();
  e.objectRanges.forEach((V) => {
    const fe = h.objects.find((ce) => ce.id === V.objectId);
    if (
      fe &&
      (fe.type === "satin" || fe.type === "satinBorder" || fe.type === "zigzag" || fe.type === "applique")
    )
      for (let ce = V.start; ce < V.end; ce++) ie.add(ce);
  });
  for (let V = 1; V < e.stitches.length; V++) {
    const fe = e.stitches[V - 1],
      ce = e.stitches[V];
    if (fe.c !== STITCH || ce.c !== STITCH) continue;
    const F = Math.hypot(ce.x - fe.x, ce.y - fe.y);
    (F > 1e-6 && F < QC_THRESHOLDS.shortStitch && _++,
      F > QC_THRESHOLDS.longStitchWarn &&
        F <= QC_THRESHOLDS.machineMaxStitch &&
        !ie.has(V) &&
        (X++,
        K.length < 50 &&
          K.push({
            x: ce.x,
            y: ce.y,
          })));
  }
  (_ > Math.max(10, o.stitches * 0.01)
    ? i.push({
        level: "warning",
        code: "stitch.short",
        value: _,
        message: `${_} points de moins de ${QC_THRESHOLDS.shortStitch} mm : risque de nœuds et de casse du fil.`,
      })
    : _ > 0 &&
      i.push({
        level: "info",
        code: "stitch.short",
        value: _,
        message: `${_} point(s) très courts (< ${QC_THRESHOLDS.shortStitch} mm), en nombre acceptable.`,
      }),
    X &&
      i.push({
        level: "warning",
        code: "stitch.long",
        value: X,
        at: K,
        message: `${X} point(s) de plus de ${QC_THRESHOLDS.longStitchWarn} mm hors satin : ils peuvent s'accrocher.`,
      }));
  const ne = new Map(),
    ge = [];
  for (const V of e.stitches) V.c === STITCH && ge.push(V);
  ge.forEach((V, fe) => {
    const ce = `${Math.floor(V.x / QC_THRESHOLDS.pileRadius)},${Math.floor(V.y / QC_THRESHOLDS.pileRadius)}`,
      F = ne.get(ce);
    F ? F.push(fe) : ne.set(ce, [fe]);
  });
  const le = [];
  for (const [V, fe] of ne) {
    if (fe.length <= QC_THRESHOLDS.pileCount) continue;
    const [ce, F] = V.split(",").map(Number);
    le.push({
      x: (ce + 0.5) * QC_THRESHOLDS.pileRadius,
      y: (F + 0.5) * QC_THRESHOLDS.pileRadius,
    });
  }
  le.length &&
    i.push({
      level: "warning",
      code: "stitch.pile",
      value: le.length,
      at: le.slice(0, 50),
      message: `${le.length} endroit(s) reçoivent plus de ${QC_THRESHOLDS.pileCount} pénétrations dans ${QC_THRESHOLDS.pileRadius} mm : risque de nid de fil ou de casse.`,
    });
  const oe = [],
    Y = [];
  for (const V of h.objects)
    if (
      V.visible &&
      (V.type === "fill" &&
        V.fill.underlay === "none" &&
        m_ao(V.shape) > QC_THRESHOLDS.underlayFillArea &&
        oe.push(V.id),
      V.type === "satin")
    ) {
      const fe = m_Qd(V.shape) * 2;
      V.satin.underlay === "none" && fe > QC_THRESHOLDS.underlaySatinWidth
        ? oe.push(V.id)
        : V.satin.underlay === "center" && fe > 5 && Y.push(V.id);
    }
  (oe.length &&
    i.push({
      level: "warning",
      code: "underlay.missing",
      objects: oe,
      message: `${oe.length} objet(s) sans sous-couche alors que leur taille en demande une : le tissu peut se voir et onduler.`,
    }),
    Y.length &&
      i.push({
        level: "info",
        code: "underlay.weak",
        objects: Y,
        message: `${Y.length} satin(s) de plus de 5 mm avec une simple ligne centrale : une sous-couche zigzag ou de bord tiendrait mieux.`,
      }));
  const Z = h.objects
    .filter(
      (V) =>
        (V.type === "fill" && V.fill.pullComp > QC_THRESHOLDS.maxPullComp) ||
        ((V.type === "satin" || V.type === "satinBorder") && V.satin.pullComp > QC_THRESHOLDS.maxPullComp),
    )
    .map((V) => V.id);
  Z.length &&
    i.push({
      level: "warning",
      code: "pullcomp.high",
      objects: Z,
      message: `${Z.length} objet(s) avec plus de ${QC_THRESHOLDS.maxPullComp} mm de compensation : les formes déborderont.`,
    });
  const te = h.objects.filter((V) => V.visible && V.type === "fill"),
    be = te.map((V) => m_Of(V.shape.outer)),
    Ae = [];
  for (let V = 0; V < te.length; V++)
    for (let fe = V + 1; fe < te.length; fe++) {
      const ce = be[V],
        F = be[fe],
        $ = Math.max(ce.minX, F.minX),
        ue = Math.min(ce.maxX, F.maxX),
        ae = Math.max(ce.minY, F.minY),
        Te = Math.min(ce.maxY, F.maxY);
      if (ue <= $ || Te <= ae) continue;
      let Me = 0;
      for (let de = $ + 0.5; de < ue; de += 1)
        for (let je = ae + 0.5; je < Te; je += 1)
          m_wl(
            {
              x: de,
              y: je,
            },
            te[V].shape,
          ) &&
            m_wl(
              {
                x: de,
                y: je,
              },
              te[fe].shape,
            ) &&
            Me++;
      const Ne = Math.min(m_ao(te[V].shape), m_ao(te[fe].shape));
      Ne > 0 && Me / Ne > QC_THRESHOLDS.overlapShare && Ae.push(`${te[V].id}+${te[fe].id}`);
    }
  return (
    Ae.length &&
      i.push({
        level: "warning",
        code: "objects.overlap",
        objects: Ae.flatMap((V) => V.split("+")),
        value: Ae.length,
        message: `${Ae.length} paire(s) de remplissages superposés à plus de ${Math.round(QC_THRESHOLDS.overlapShare * 100)} % : densité cumulée et broderie dure. Évidez la zone du dessous.`,
      }),
    n &&
      n.status === "vérifié" &&
      n.maxStitches == null &&
      i.push({
        level: "info",
        code: "machine.limits",
        message: `Limite de points de la ${n.model} non publiée : ${o.stitches.toLocaleString("fr")} points, à vérifier lors du test physique.`,
      }),
    o.stitches === 0 &&
      i.push({
        level: "error",
        code: "design.empty",
        message: "Aucun point à broder.",
      }),
    {
      issues: i,
      blocking: i.some((V) => V.level === "error"),
      densityMax: p,
    }
  );
}
const PENDING_CHARTS = [
    {
      brand: "Madeira",
      product: "Polyneon / Rayon",
      note: "Importer le nuancier officiel Madeira (CSV).",
    },
    {
      brand: "Isacord",
      product: "Isacord 40",
      note: "Importer le nuancier officiel Amann Isacord (CSV).",
    },
    {
      brand: "Sulky",
      product: "Rayon 40",
      note: "Importer le nuancier officiel Sulky (CSV).",
    },
    {
      brand: "Robison-Anton",
      product: "Rayon / Polyester",
      note: "Importer le nuancier officiel Robison-Anton (CSV).",
    },
  ],
  PEC_CHART = {
    id: "brother-pec",
    brand: "Brother",
    product: "Palette PEC des machines (64 couleurs)",
    status: "approximatif",
    source:
      "pyembroidery 1.5.1 (MIT), table EmbThreadPec : couleurs d'affichage des machines Brother, pas un nuancier de bobines",
    sourceUrl: "https://github.com/EmbroidePy/pyembroidery",
    entries: m_jm.flatMap((h) =>
      h
        ? [
            {
              code: h[2],
              name: h[1],
              rgb: "#" + h[0].toString(16).padStart(6, "0"),
              approximate: !0,
            },
          ]
        : [],
    ),
  },
  m_O3 = /^#?[0-9a-fA-F]{6}$/;
function m_R3(h) {
  const e = [];
  (h.brand.trim() || e.push("Marque manquante."),
    h.source.trim() ||
      e.push("Source manquante : indiquez le document ou le site d’où viennent les couleurs."),
    ["officiel", "approximatif", "utilisateur"].includes(h.status) || e.push("Statut inconnu."),
    h.status === "officiel" &&
      !h.sourceUrl &&
      !/\d{4}/.test(h.source) &&
      e.push("Un nuancier officiel doit citer son lien ou au moins le titre et l’année du document."),
    h.entries.length || e.push("Aucune couleur."));
  const n = new Set();
  return (
    h.entries.forEach((s, i) => {
      (s.code.trim() || e.push(`Ligne ${i + 1} : référence manquante.`),
        m_O3.test(s.rgb) || e.push(`Ligne ${i + 1} : couleur « ${s.rgb} » invalide (attendu #RRVVBB).`),
        n.has(s.code) && e.push(`Ligne ${i + 1} : référence ${s.code} en double.`),
        n.add(s.code));
    }),
    e
  );
}
function m_kb(h, e) {
  const n = [];
  let s = "",
    i = !1;
  for (let o = 0; o < h.length; o++) {
    const l = h[o];
    i
      ? l === '"' && h[o + 1] === '"'
        ? ((s += '"'), o++)
        : l === '"'
          ? (i = !1)
          : (s += l)
      : l === '"'
        ? (i = !0)
        : l === e
          ? (n.push(s.trim()), (s = ""))
          : (s += l);
  }
  return (n.push(s.trim()), n);
}
function parseChartCsv(h, e) {
  const n = h
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .filter((j) => j.trim());
  if (!n.length)
    return {
      chart: {
        ...e,
        id: "",
        entries: [],
      },
      errors: ["Fichier vide."],
    };
  const s = (n[0].match(/;/g)?.length ?? 0) > (n[0].match(/,/g)?.length ?? 0) ? ";" : ",",
    i = m_kb(n[0], s).map((j) => j.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")),
    o = (...j) => i.findIndex((k) => j.includes(k)),
    l = o("code", "ref", "reference", "numero", "number", "no", "n"),
    c = o("name", "nom", "description", "color name", "nom couleur"),
    u = o("hex", "rgb", "couleur", "color", "html"),
    d = o("r", "red", "rouge"),
    p = o("g", "v", "green", "vert"),
    g = o("b", "blue", "bleu"),
    w = [];
  (l < 0 && w.push("Colonne de référence introuvable (code, ref, reference…)."),
    u < 0 && (d < 0 || p < 0 || g < 0) && w.push("Colonne de couleur introuvable (hex ou r, g, b)."));
  const y = [];
  if (!w.length)
    for (const j of n.slice(1)) {
      const k = m_kb(j, s);
      let x = "";
      (u >= 0 && k[u]
        ? (x = k[u].startsWith("#") ? k[u] : "#" + k[u])
        : d >= 0 &&
          (x =
            "#" +
            [k[d], k[p], k[g]]
              .map((A) =>
                Math.max(0, Math.min(255, parseInt(A, 10) || 0))
                  .toString(16)
                  .padStart(2, "0"),
              )
              .join("")),
        y.push({
          code: k[l] ?? "",
          name: c >= 0 ? (k[c] ?? "") : "",
          rgb: x.toLowerCase(),
          approximate: e.status !== "officiel",
        }));
    }
  const v = {
    ...e,
    id: `${e.brand}-${e.product}`.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
    entries: y,
  };
  return {
    chart: v,
    errors: [...w, ...(w.length ? [] : m_R3(v))],
  };
}
function m_Sb(h) {
  const e = parseInt(h.slice(1), 16);
  return [(e >> 16) & 255, (e >> 8) & 255, e & 255];
}
function m_N3(h, e) {
  const [n, s, i] = m_Sb(h),
    [o, l, c] = m_Sb(e),
    u = (n + o) / 2,
    d = n - o,
    p = s - l,
    g = i - c;
  return ((512 + u) * d * d) / 256 + 4 * p * p + ((767 - u) * g * g) / 256;
}
function matchChartEntries(h, e, n = 3) {
  return e.entries
    .map((s) => ({
      entry: s,
      delta: Math.sqrt(m_N3(h, s.rgb)),
    }))
    .sort((s, i) => s.delta - i.delta)
    .slice(0, n);
}
const LANG_INDEX = {
    nl: 0,
    en: 1,
    ar: 2,
  },
  m_P3 = /\d+(?:[  ]\d{3})*(?:[.,]\d+)?/g,
  m_L3 = {
    "machine.unverified": [
      "Onvolledig machineprofiel: export geblokkeerd zolang de limieten niet zijn ingevuld.",
      "Incomplete machine profile: export is blocked until its limits are filled in.",
      "ملف الماكينة غير مكتمل: التصدير محظور إلى أن تُدخل حدودها.",
    ],
    "hoop.overflow": [
      "Het motief ({0} × {1} mm) is groter dan het borduurraam {hoop} ({2} × {3} mm).",
      "The design ({0} × {1} mm) exceeds the hoop {hoop} ({2} × {3} mm).",
      "التصميم ({0} × {1} مم) يتجاوز الإطار {hoop} ({2} × {3} مم).",
    ],
    "hoop.margin": [
      "Slechts {0} mm marge tot de rand van het raam ({1} mm aanbevolen): de persvoet kan het raam raken.",
      "Only {0} mm margin to the hoop edge ({1} mm recommended): the presser foot may hit the hoop.",
      "هامش {0} مم فقط عند حافة الإطار (الموصى به {1} مم): قد تلمس القدم الضاغطة الإطار.",
    ],
    "hoop.unconfirmed": [
      "Metrische afmetingen van {hoop} te bevestigen in de handleiding van de machine.",
      "Metric dimensions of {hoop} to be confirmed in the machine manual.",
      "الأبعاد المترية للإطار {hoop} بحاجة إلى تأكيد من دليل الماكينة.",
    ],
    "stitch.tooLong": [
      "{0} steek/steken langer dan {1} mm.",
      "{0} stitch(es) longer than {1} mm.",
      "{0} غرزة أطول من {1} مم.",
    ],
    "satin.tooWide": [
      "{0} satijnzone(s) hebben steken langer dan {1} mm: schakel over op tatami of verklein de breedte.",
      "{0} satin area(s) have stitches longer than {1} mm: switch to tatami or reduce the width.",
      "{0} منطقة ساتان فيها غرز أطول من {1} مم: حوّلها إلى تاتامي أو قلّل العرض.",
    ],
    "density.block": [
      "Dichtheid van {0} naaldinsteken/mm² (limiet {1}): risico op naaldbreuk, export geblokkeerd.",
      "Density of {0} penetrations/mm² (limit {1}): risk of needle breakage, export blocked.",
      "كثافة {0} اختراقًا/مم² (الحد {1}): خطر كسر الإبرة، التصدير محظور.",
    ],
    "density.high": [
      "Zeer hoge dichtheid: tot {0} naaldinsteken/mm² ({1} mm² boven {2}). Risico op garenophoping en naaldbreuk.",
      "Very high density: up to {0} penetrations/mm² ({1} mm² above {2}). Risk of thread build-up and needle breakage.",
      "كثافة عالية جدًا: حتى {0} اختراقًا/مم² ({1} مم² فوق {2}). خطر تراكم الخيط وكسر الإبرة.",
    ],
    "density.local": [
      "{0} mm² boven {1} naaldinsteken/mm² (vaak afhechtsteken of aansluitingen).",
      "{0} mm² above {1} penetrations/mm² (often tie-off stitches or junctions).",
      "{0} مم² فوق {1} اختراقًا/مم² (غالبًا غرز التثبيت أو نقاط الالتقاء).",
    ],
    "stitch.duplicate": [
      "{0} opeenvolgende steken op dezelfde plaats.",
      "{0} consecutive stitches at the same position.",
      "{0} غرزة متتالية في الموضع نفسه.",
    ],
    "contour.invalid": [
      "{0} contour(en) niet gesloten of zelfkruisend: de vulling kan onregelmatig zijn.",
      "{0} outline(s) not closed or self-intersecting: the fill may be irregular.",
      "{0} محيط غير مغلق أو متقاطع مع نفسه: قد تكون التعبئة غير منتظمة.",
    ],
    "detail.small": [
      "{0} detail(s) te klein om netjes te borduren (< {1} mm²).",
      "{0} detail(s) too small to embroider cleanly (< {1} mm²).",
      "{0} تفصيل أصغر من أن يُطرَّز بشكل نظيف (< {1} مم²).",
    ],
    "jump.many": [
      "{0} draadknippen: overweeg de objecten te groeperen of te herschikken.",
      "{0} thread trims: consider grouping or reordering the objects.",
      "{0} قطع للخيط: يُستحسن تجميع العناصر أو إعادة ترتيبها.",
    ],
    "jump.long": [
      "{0} verplaatsing(en) langer dan {1} mm (automatisch geknipt).",
      "{0} jump(s) longer than {1} mm (trimmed automatically).",
      "{0} انتقال أطول من {1} مم (يُقطع تلقائيًا).",
    ],
    "color.redundant": [
      "{0} garenwissel(s) naar dezelfde kleur.",
      "{0} thread change(s) to the same color.",
      "{0} تغيير خيط إلى اللون نفسه.",
    ],
    "color.regroup": [
      "{0} kleur(en) komen meermaals terug: groeperen zou het aantal kloswissels verminderen als de stapeling het toelaat.",
      "{0} color(s) come back several times: grouping would reduce spool changes if the layering allows it.",
      "{0} لون يتكرر عدة مرات: التجميع يقلّل تغيير البكرات إذا سمح ترتيب الطبقات.",
    ],
    "color.pesLimit": [
      "Het PES-formaat aanvaardt hoogstens {0} kleurwissels.",
      "The PES format accepts at most {0} color changes.",
      "صيغة PES تقبل {0} تغيير لون على الأكثر.",
    ],
    "pullcomp.low": [
      "{0} object(en) met een trekcompensatie < {1} mm: risico op openingen tussen de zones.",
      "{0} object(s) with pull compensation < {1} mm: risk of gaps between areas.",
      "{0} عنصر بتعويض شدّ < {1} مم: خطر ظهور فراغات بين المناطق.",
    ],
    "stitch.short": {
      warning: [
        "{0} steken korter dan {1} mm: risico op knopen en draadbreuk.",
        "{0} stitches shorter than {1} mm: risk of knots and thread breakage.",
        "{0} غرزة أقصر من {1} مم: خطر تكوّن عُقد وانقطاع الخيط.",
      ],
      info: [
        "{0} zeer korte steek/steken (< {1} mm), in aanvaardbaar aantal.",
        "{0} very short stitch(es) (< {1} mm), in acceptable number.",
        "{0} غرزة قصيرة جدًا (< {1} مم)، بعدد مقبول.",
      ],
    },
    "stitch.long": [
      "{0} steek/steken langer dan {1} mm buiten satijn: ze kunnen blijven haken.",
      "{0} stitch(es) longer than {1} mm outside satin: they may snag.",
      "{0} غرزة أطول من {1} مم خارج الساتان: قد تعلق.",
    ],
    "stitch.pile": [
      "{0} plaats(en) krijgen meer dan {1} naaldinsteken binnen {2} mm: risico op garennest of breuk.",
      "{0} spot(s) receive more than {1} penetrations within {2} mm: risk of thread nest or breakage.",
      "{0} موضع يتلقى أكثر من {1} اختراقًا ضمن {2} مم: خطر تشابك الخيط أو الانقطاع.",
    ],
    "underlay.missing": [
      "{0} object(en) zonder onderlaag terwijl hun grootte er een vraagt: de stof kan zichtbaar worden en golven.",
      "{0} object(s) without underlay although their size requires one: the fabric may show through and pucker.",
      "{0} عنصر بلا غرز تأسيس مع أن حجمه يتطلبها: قد يظهر القماش ويتموّج.",
    ],
    "underlay.weak": [
      "{0} satijn(en) breder dan {1} mm met alleen een middenlijn: een zigzag- of randonderlaag houdt beter.",
      "{0} satin(s) wider than {1} mm with only a center line: a zigzag or edge underlay would hold better.",
      "{0} ساتان أعرض من {1} مم بخط وسط فقط: تأسيس متعرّج أو على الحافة يثبت أفضل.",
    ],
    "pullcomp.high": [
      "{0} object(en) met meer dan {1} mm compensatie: de vormen zullen uitlopen.",
      "{0} object(s) with more than {1} mm of compensation: shapes will overflow.",
      "{0} عنصر بتعويض يفوق {1} مم: ستتجاوز الأشكال حدودها.",
    ],
    "objects.overlap": [
      "{0} paar/paren vullingen overlappen voor meer dan {1} %: opgetelde dichtheid en hard borduurwerk. Hol de onderste zone uit.",
      "{0} pair(s) of fills overlap by more than {1}%: cumulative density and stiff embroidery. Cut out the area underneath.",
      "{0} زوج من التعبئات متراكب بأكثر من {1}٪: كثافة متراكمة وتطريز قاسٍ. فرّغ المنطقة السفلية.",
    ],
    "machine.limits": [
      "Steeklimiet van de {model} niet gepubliceerd: {0} steken, te controleren bij de fysieke test.",
      "Stitch limit of the {model} not published: {0} stitches, to be checked during the physical test.",
      "حد الغرز للماكينة {model} غير منشور: {0} غرزة، يُتحقق منه في الاختبار الفعلي.",
    ],
    "design.empty": ["Geen steken om te borduren.", "No stitches to embroider.", "لا توجد غرز للتطريز."],
  },
  m_z3 = (h) => new Set(h.match(/\{\d+\}/g) ?? []).size,
  m_U3 = (h, e, n) =>
    h.replace(/\{(\d+)\}/g, (s, i) => e[+i]).replace(/\{(hoop|model)\}/g, (s, i) => n[i] ?? "");
function translateIssue(h, e, n = {}) {
  if (h === "fr")
    return {
      text: e.message,
      fallback: !1,
    };
  const s = m_L3[e.code],
    i = Array.isArray(s) ? s : s?.[e.level];
  if (!i)
    return {
      text: e.message,
      fallback: !0,
    };
  const o = i[LANG_INDEX[h]];
  let l = e.message;
  for (const p of [n.hoop, n.model]) p && (l = l.split(p).join(" "));
  const c = l.match(m_P3) ?? [],
    u = o.includes("{hoop}") && !n.hoop,
    d = o.includes("{model}") && !n.model;
  return c.length !== m_z3(o) || u || d
    ? {
        text: e.message,
        fallback: !0,
      }
    : {
        text: m_U3(o, c, {
          hoop: n.hoop ?? "",
          model: n.model ?? "",
        }),
        fallback: !1,
      };
}
function translateStrategy(h, e) {
  if (h === "fr")
    return {
      text: e.reason,
      fallback: !1,
    };
  const n = LANG_INDEX[h];
  if (e.type === "fill")
    return {
      text: ["oppervlakte {0} mm²: tatami", "area {0} mm²: tatami", "المساحة {0} مم²: تاتامي"][n].replace(
        "{0}",
        e.areaMm2.toFixed(0),
      ),
      fallback: !1,
    };
  if (e.type === "satin")
    return {
      text: ["smalle band (≈{0} mm): satijn", "narrow band (≈{0} mm): satin", "شريط ضيق (≈{0} مم): ساتان"][
        n
      ].replace("{0}", e.widthMm.toFixed(1)),
      fallback: !1,
    };
  if (e.type === "triple") {
    const s = e.reason.includes("médiane"),
      i = e.reason.includes("contour");
    if (s === i)
      return {
        text: e.reason,
        fallback: !0,
      };
    const o = s
      ? ["op de middenlijn", "on the center line", "على الخط الأوسط"]
      : ["op de contour", "on the outline", "على المحيط"];
    return {
      text: [
        "breedte {0} mm: fijne lijn, drievoudige steek {w}",
        "width {0} mm: thin line, triple stitch {w}",
        "العرض {0} مم: خط رفيع، غرزة ثلاثية {w}",
      ][n]
        .replace("{0}", e.widthMm.toFixed(1))
        .replace("{w}", o[n]),
      fallback: !1,
    };
  }
  return {
    text: e.reason,
    fallback: !0,
  };
}
const m_V3 = {
    sa439s: [
      "Technische fiche Brother Stellaire XE1: raam 5″ × 7″ (SA439S) meegeleverd; metrische afmetingen 130 × 180 mm te bevestigen in de handleiding.",
      "Brother Stellaire XE1 spec sheet: 5″ × 7″ hoop (SA439S) included; metric dimensions 130 × 180 mm to be confirmed in the manual.",
      "ورقة مواصفات Brother Stellaire XE1: الإطار 5″ × 7″ (SA439S) مرفق؛ الأبعاد المترية 130 × 180 مم بحاجة إلى تأكيد من الدليل.",
    ],
    sa449s: [
      "Technische fiche Brother Stellaire XE1: raam 9,5″ × 14″ (SA449S) meegeleverd.",
      "Brother Stellaire XE1 spec sheet: 9.5″ × 14″ hoop (SA449S) included.",
      "ورقة مواصفات Brother Stellaire XE1: الإطار 9.5″ × 14″ (SA449S) مرفق.",
    ],
  },
  m_W3 = {
    "Formats lus autres que PES (DST, PHC…) à confirmer dans le manuel avant de les proposer. Limite de points non publiée sur la fiche.":
      [
        "Andere gelezen formaten dan PES (DST, PHC…) te bevestigen in de handleiding voor ze worden aangeboden. Steeklimiet niet gepubliceerd op de fiche.",
        "Formats read other than PES (DST, PHC…) to be confirmed in the manual before being offered. Stitch limit not published on the spec sheet.",
        "الصيغ المقروءة غير PES (DST، PHC…) بحاجة إلى تأكيد من الدليل قبل عرضها. حد الغرز غير منشور في ورقة المواصفات.",
      ],
    "Cadres et limites à saisir depuis la fiche officielle.": [
      "Ramen en limieten in te vullen vanaf de officiële fiche.",
      "Hoops and limits to be entered from the official spec sheet.",
      "الإطارات والحدود تُدخل من ورقة المواصفات الرسمية.",
    ],
    "Format natif (JEF, EXP/ART, VP3) et cadres à saisir.": [
      "Eigen formaat (JEF, EXP/ART, VP3) en ramen in te vullen.",
      "Native format (JEF, EXP/ART, VP3) and hoops to be entered.",
      "الصيغة الأصلية (JEF، EXP/ART، VP3) والإطارات بحاجة إلى إدخال.",
    ],
  },
  m_xb = {
    "pyembroidery 1.5.1 (MIT), table EmbThreadPec : couleurs d'affichage des machines Brother, pas un nuancier de bobines":
      [
        "pyembroidery 1.5.1 (MIT), tabel EmbThreadPec: weergavekleuren van Brother-machines, geen kleurkaart van klossen",
        "pyembroidery 1.5.1 (MIT), EmbThreadPec table: display colors of Brother machines, not a spool color chart",
        "pyembroidery 1.5.1 (MIT)، جدول EmbThreadPec: ألوان العرض في ماكينات Brother وليست بطاقة ألوان بكرات",
      ],
  },
  m_qm = (h, e, n, s) =>
    h === "fr"
      ? {
          text: s,
          fallback: !1,
        }
      : e[n]
        ? {
            text: e[n][LANG_INDEX[h]],
            fallback: !1,
          }
        : {
            text: s,
            fallback: !0,
          },
  translateHoopSource = (h, e) => m_qm(h, m_V3, e.id, e.source),
  translateMachineNote = (h, e) => m_qm(h, m_W3, e, e),
  translateChartSource = (h, e) =>
    m_xb[e]
      ? m_qm(h, m_xb, e, e)
      : {
          text: e,
          fallback: !1,
        },
  REGISTRY_FILES = {
    "brother-xe1": "registre/xe1-essais.json",
  },
  REFERENCE_FINGERPRINTS_FILE = "registre/empreintes-reference-v0.2.0.sha256";
function registryFileStatus(h) {
  if (!h || typeof h.statut != "string") return "insufficient";
  const e = h.essais?.[h.essais.length - 1],
    n = (e?.anomalies ?? []).filter((s) => s.ouverte !== !1);
  switch (h.statut) {
    case "Non testé":
      return h.essais?.length ? "insufficient" : "untested";
    case "Testé avec anomalie":
      return e
        ? e.lecture_machine?.fichier_lu === !1 || n.some((s) => s.gravite === "bloquante")
          ? "failure"
          : "reserves"
        : "insufficient";
    case "Testé et accepté":
      return e ? (n.length ? "reserves" : "success") : "insufficient";
    case "Validé pour Brother XE1":
      return e ? "success" : "insufficient";
    default:
      return "insufficient";
  }
}
const m_qb = () => ({
  untested: 0,
  planned: 0,
  running: 0,
  success: 0,
  reserves: 0,
  failure: 0,
  insufficient: 0,
});
function summarizeRegistry(h) {
  const e = {
    available: !1,
    overall: "insufficient",
    total: 0,
    tested: 0,
    counts: m_qb(),
    files: [],
    reference: null,
  };
  if (!h || typeof h != "object" || !h.fichiers || typeof h.fichiers != "object") return e;
  const n = Object.entries(h.fichiers).map(([l, c]) => {
    const u = c?.essais?.[c.essais.length - 1];
    return {
      path: l,
      format: c?.format ?? "",
      status: registryFileStatus(c),
      date: u?.date ?? null,
      observations: u?.observations ?? null,
      proofs: u?.photos?.length ?? 0,
      registryStatus: typeof c?.statut == "string" ? c.statut : null,
    };
  });
  if (!n.length) return e;
  const s = m_qb();
  for (const l of n) s[l.status]++;
  const i = s.success + s.reserves + s.failure;
  return {
    available: !0,
    overall:
      s.insufficient === n.length
        ? "insufficient"
        : i === 0
          ? "untested"
          : s.failure
            ? "failure"
            : i < n.length
              ? "running"
              : s.reserves
                ? "reserves"
                : "success",
    total: n.length,
    tested: i,
    counts: s,
    files: n,
    reference: h.version_logiciel_reference ?? null,
  };
}
async function sha256Hex(h) {
  try {
    const e = await crypto.subtle.digest("SHA-256", h);
    return [...new Uint8Array(e)].map((n) => n.toString(16).padStart(2, "0")).join("");
  } catch {
    return null;
  }
}
const DEFAULT_TRACE_OPTIONS = {
  colors: 6,
  targetWidthMm: 100,
  maxHeightMm: 170,
  removeBackground: "auto",
  minDetailMm2: 2,
  satinMaxWidthMm: 6,
  runMaxWidthMm: 1,
  overlapMm: 0.35,
  smoothing: 2,
  simplifyPx: 0.7,
};
function m_Zd(h, e, n) {
  const s = (g) => ((g /= 255), g <= 0.04045 ? g / 12.92 : ((g + 0.055) / 1.055) ** 2.4),
    i = s(h),
    o = s(e),
    l = s(n);
  let c = (i * 0.4124 + o * 0.3576 + l * 0.1805) / 0.95047,
    u = i * 0.2126 + o * 0.7152 + l * 0.0722,
    d = (i * 0.0193 + o * 0.1192 + l * 0.9505) / 1.08883;
  const p = (g) => (g > 0.008856 ? Math.cbrt(g) : 7.787 * g + 16 / 116);
  return ((c = p(c)), (u = p(u)), (d = p(d)), [116 * u - 16, 500 * (c - u), 200 * (u - d)]);
}
const m_i6 = (h, e, n) => "#" + [h, e, n].map((s) => Math.round(s).toString(16).padStart(2, "0")).join("");
function m_r6(h) {
  let e = h >>> 0;
  return () => ((e = (e * 1664525 + 1013904223) >>> 0), e / 4294967296);
}
function m_Cw(h, e, n) {
  const s = new Uint8ClampedArray(e * n * 4),
    i = h.width / e,
    o = h.height / n;
  for (let l = 0; l < n; l++)
    for (let c = 0; c < e; c++) {
      const u = Math.floor(c * i),
        d = Math.max(u + 1, Math.floor((c + 1) * i)),
        p = Math.floor(l * o),
        g = Math.max(p + 1, Math.floor((l + 1) * o));
      let w = 0,
        y = 0,
        v = 0,
        j = 0,
        k = 0;
      for (let A = p; A < g && A < h.height; A++)
        for (let C = u; C < d && C < h.width; C++) {
          const I = (A * h.width + C) * 4,
            E = h.data[I + 3];
          ((w += h.data[I] * E), (y += h.data[I + 1] * E), (v += h.data[I + 2] * E), (j += E), k++);
        }
      const x = (l * e + c) * 4;
      (j > 0 && ((s[x] = w / j), (s[x + 1] = y / j), (s[x + 2] = v / j)), (s[x + 3] = k ? j / k : 0));
    }
  return {
    width: e,
    height: n,
    data: s,
  };
}
function m_Tw(h, e) {
  const { width: n, height: s, data: i } = h,
    o = new Uint8Array(n * s);
  let l = !1;
  for (let k = 0; k < n * s; k++) i[k * 4 + 3] < 128 && ((o[k] = 1), (l = !0));
  if (e === "none" || (e === "auto" && l) || e === "alpha") return o;
  const c = new Map(),
    u = (k) => ((i[k * 4] >> 4) << 8) | ((i[k * 4 + 1] >> 4) << 4) | (i[k * 4 + 2] >> 4),
    d = [];
  for (let k = 0; k < n; k++) d.push(k, (s - 1) * n + k);
  for (let k = 0; k < s; k++) d.push(k * n, k * n + n - 1);
  for (const k of d) c.set(u(k), (c.get(u(k)) ?? 0) + 1);
  let p = -1,
    g = 0;
  for (const [k, x] of c) x > g && ((g = x), (p = k));
  if (g < d.length * 0.5) return o;
  const w = [((p >> 8) & 15) * 16 + 8, ((p >> 4) & 15) * 16 + 8, (p & 15) * 16 + 8],
    y = m_Zd(w[0], w[1], w[2]);
  if (e === "auto" && !(y[0] > 88 && Math.hypot(y[1], y[2]) < 12)) return o;
  const v = (k) => {
      const x = m_Zd(i[k * 4], i[k * 4 + 1], i[k * 4 + 2]);
      return (x[0] - y[0]) ** 2 + (x[1] - y[1]) ** 2 + (x[2] - y[2]) ** 2 < 196;
    },
    j = [];
  for (const k of d) !o[k] && v(k) && ((o[k] = 1), j.push(k));
  for (; j.length;) {
    const k = j.pop(),
      x = k % n,
      A = (k - x) / n,
      C = [x > 0 ? k - 1 : -1, x < n - 1 ? k + 1 : -1, A > 0 ? k - n : -1, A < s - 1 ? k + n : -1];
    for (const I of C) I >= 0 && !o[I] && i[I * 4 + 3] >= 128 && v(I) && ((o[I] = 1), j.push(I));
  }
  return o;
}
function m_o6(h, e, n) {
  const s = h.width * h.height,
    i = [];
  for (let j = 0; j < s; j++) e[j] || i.push(j);
  const o = new Int16Array(s).fill(-1);
  if (i.length === 0)
    return {
      labels: o,
      palette: [],
    };
  const l = new Float32Array(s * 3);
  for (const j of i) {
    const k = m_Zd(h.data[j * 4], h.data[j * 4 + 1], h.data[j * 4 + 2]);
    ((l[j * 3] = k[0]), (l[j * 3 + 1] = k[1]), (l[j * 3 + 2] = k[2]));
  }
  const c = m_r6(12345),
    u = Math.max(1, Math.floor(i.length / 4e3)),
    d = i.filter((j, k) => k % u === 0),
    p = (j, k) => (l[j * 3] - k[0]) ** 2 + (l[j * 3 + 1] - k[1]) ** 2 + (l[j * 3 + 2] - k[2]) ** 2,
    g = [],
    w = d[Math.floor(c() * d.length)];
  for (g.push([l[w * 3], l[w * 3 + 1], l[w * 3 + 2]]); g.length < n;) {
    const j = d.map((C) => Math.min(...g.map((I) => p(C, I)))),
      k = j.reduce((C, I) => C + I, 0);
    if (k < 1e-6) break;
    let x = c() * k,
      A = d[0];
    for (let C = 0; C < d.length; C++)
      if (((x -= j[C]), x <= 0)) {
        A = d[C];
        break;
      }
    g.push([l[A * 3], l[A * 3 + 1], l[A * 3 + 2]]);
  }
  for (let j = 0; j < 12; j++) {
    const k = g.map(() => [0, 0, 0, 0]);
    for (const A of i) {
      let C = 0,
        I = 1 / 0;
      for (let O = 0; O < g.length; O++) {
        const B = p(A, g[O]);
        B < I && ((I = B), (C = O));
      }
      o[A] = C;
      const E = k[C];
      ((E[0] += l[A * 3]), (E[1] += l[A * 3 + 1]), (E[2] += l[A * 3 + 2]), E[3]++);
    }
    let x = 0;
    if (
      (g.forEach((A, C) => {
        const I = k[C];
        if (I[3] === 0) return;
        const E = [I[0] / I[3], I[1] / I[3], I[2] / I[3]];
        ((x += Math.abs(E[0] - A[0]) + Math.abs(E[1] - A[1]) + Math.abs(E[2] - A[2])), (g[C] = E));
      }),
      x < 0.5)
    )
      break;
  }
  const y = g.map(() => [0, 0, 0, 0]);
  for (const j of i) {
    const k = y[o[j]];
    ((k[0] += h.data[j * 4]), (k[1] += h.data[j * 4 + 1]), (k[2] += h.data[j * 4 + 2]), k[3]++);
  }
  const v = y.map((j) => (j[3] ? [j[0] / j[3], j[1] / j[3], j[2] / j[3]] : [0, 0, 0]));
  return {
    labels: o,
    palette: v,
  };
}
function m_Cb(h, e, n) {
  const s = new Int16Array(h);
  for (let i = 1; i < n - 1; i++)
    for (let o = 1; o < e - 1; o++) {
      const l = i * e + o,
        c = new Map();
      for (let p = -1; p <= 1; p++)
        for (let g = -1; g <= 1; g++) {
          const w = h[l + p * e + g];
          c.set(w, (c.get(w) ?? 0) + 1);
        }
      let u = h[l],
        d = c.get(h[l]) ?? 0;
      for (const [p, g] of c) g > d && ((d = g), (u = p));
      d >= 5 && (s[l] = u);
    }
  return s;
}
function m_l6(h, e, n) {
  const s = new Int32Array(e * n).fill(-1),
    i = [];
  for (let o = 0; o < e * n; o++) {
    if (s[o] !== -1 || h[o] < 0) continue;
    const l = i.length,
      c = h[o],
      u = [],
      d = [o];
    for (s[o] = l; d.length;) {
      const p = d.pop();
      u.push(p);
      const g = p % e,
        w = (p - g) / e,
        y = [g > 0 ? p - 1 : -1, g < e - 1 ? p + 1 : -1, w > 0 ? p - e : -1, w < n - 1 ? p + e : -1];
      for (const v of y) v >= 0 && s[v] === -1 && h[v] === c && ((s[v] = l), d.push(v));
    }
    i.push({
      label: c,
      size: u.length,
      px: u,
    });
  }
  return {
    comp: s,
    info: i,
  };
}
function m_c6(h, e, n, s) {
  let i = 0;
  for (let o = 0; o < 3; o++) {
    const { info: l } = m_l6(h, e, n);
    let c = 0;
    for (const u of l) {
      if (u.size >= s) continue;
      const d = new Map();
      for (const w of u.px) {
        const y = w % e,
          v = (w - y) / e,
          j = [y > 0 ? w - 1 : -1, y < e - 1 ? w + 1 : -1, v > 0 ? w - e : -1, v < n - 1 ? w + e : -1];
        for (const k of j) k >= 0 && h[k] !== u.label && d.set(h[k], (d.get(h[k]) ?? 0) + 1);
      }
      let p = -1,
        g = -1;
      for (const [w, y] of d) y > g && ((g = y), (p = w));
      for (const w of u.px) h[w] = p;
      c++;
    }
    if (((i += c), !c)) break;
  }
  return i;
}
function m_f6(h, e, n) {
  const s = (d, p) => d >= 0 && p >= 0 && d < e && p < n && h[p * e + d] === 1,
    i = e + 1,
    o = new Map(),
    l = (d, p, g, w) => {
      const y = p * i + d,
        v = w * i + g,
        j = o.get(y);
      j ? j.push(v) : o.set(y, [v]);
    };
  for (let d = 0; d < n; d++)
    for (let p = 0; p < e; p++)
      s(p, d) &&
        (s(p, d - 1) || l(p, d, p + 1, d),
        s(p + 1, d) || l(p + 1, d, p + 1, d + 1),
        s(p, d + 1) || l(p + 1, d + 1, p, d + 1),
        s(p - 1, d) || l(p, d + 1, p, d));
  const c = [],
    u = (d, p) => {
      const g = d % i,
        w = (d - g) / i,
        y = p % i,
        v = (p - y) / i;
      return [y - g, v - w];
    };
  for (const [d] of o)
    for (; (o.get(d)?.length ?? 0) > 0;) {
      const p = [];
      let g = d,
        w = o.get(d).pop();
      p.push({
        x: d % i,
        y: Math.floor(d / i),
      });
      let y = 0;
      for (; w !== d && y++ < 4 * e * n + 8;) {
        p.push({
          x: w % i,
          y: Math.floor(w / i),
        });
        const j = o.get(w);
        if (!j || j.length === 0) break;
        let k = 0;
        if (j.length > 1) {
          const [A, C] = u(g, w),
            I = [-C, A],
            E = j.findIndex((O) => {
              const B = u(w, O);
              return B[0] === I[0] && B[1] === I[1];
            });
          k = E >= 0 ? E : 0;
        }
        const x = j.splice(k, 1)[0];
        ((g = w), (w = x));
      }
      const v = p.filter((j, k) => {
        const x = p[(k - 1 + p.length) % p.length],
          A = p[(k + 1) % p.length];
        return (A.x - x.x) * (j.y - x.y) - (A.y - x.y) * (j.x - x.x) !== 0;
      });
      v.length >= 3 && c.push(v);
    }
  return c;
}
function m_u6(h) {
  const e = [],
    n = [];
  for (const o of h) (m_va(o) > 0 ? e : n).push(o);
  const s = e.map((o) => ({
      outer: o,
      holes: [],
    })),
    i = (o, l) => {
      let c = !1;
      for (let u = 0, d = l.length - 1; u < l.length; d = u++) {
        const p = l[u],
          g = l[d];
        p.y > o.y != g.y > o.y && o.x < ((g.x - p.x) * (o.y - p.y)) / (g.y - p.y) + p.x && (c = !c);
      }
      return c;
    };
  for (const o of n) {
    const l = {
      x: o[0].x + 0.01,
      y: o[0].y + 0.01,
    };
    let c = null,
      u = 1 / 0;
    for (const d of s) {
      if (!i(o[0], d.outer) && !i(l, d.outer)) continue;
      const p = Math.abs(m_va(d.outer));
      p < u && ((u = p), (c = d));
    }
    c && c.holes.push(o);
  }
  return s;
}
function m_Tb(h, e) {
  let n = m_ub(h, e.simplifyPx);
  return (e.smoothing > 0 && n.length >= 4 && (n = m_m3(n, e.smoothing, 1.2)), m_ub(n, 0.15));
}
function m_h6(h, e) {
  const n = Math.min(h.width, 400),
    s = Math.max(1, Math.round((h.height * n) / h.width)),
    i = m_Cw(h, n, s),
    o = m_Tw(i, e);
  let l = n,
    c = s,
    u = -1,
    d = -1;
  for (let C = 0; C < s; C++)
    for (let I = 0; I < n; I++)
      o[C * n + I] || (I < l && (l = I), I > u && (u = I), C < c && (c = C), C > d && (d = C));
  if (u < 0) return h;
  const p = h.width / n,
    g = h.height / s,
    w = Math.max(0, Math.floor((l - 1) * p)),
    y = Math.max(0, Math.floor((c - 1) * g)),
    v = Math.min(h.width, Math.ceil((u + 2) * p)),
    j = Math.min(h.height, Math.ceil((d + 2) * g));
  if (w === 0 && y === 0 && v === h.width && j === h.height) return h;
  const k = v - w,
    x = j - y,
    A = new Uint8ClampedArray(k * x * 4);
  for (let C = 0; C < x; C++)
    A.set(h.data.subarray(((y + C) * h.width + w) * 4, ((y + C) * h.width + v) * 4), C * k * 4);
  return {
    width: k,
    height: x,
    data: A,
  };
}
function traceImage(h, e = {}, n = "Motif") {
  const s = {
      ...DEFAULT_TRACE_OPTIONS,
      ...e,
    },
    i = m_h6(h, s.removeBackground),
    o = i.height / i.width;
  let l = s.targetWidthMm;
  l * o > s.maxHeightMm && (l = s.maxHeightMm / o);
  const c = l * o,
    u = Math.max(32, Math.min(700, Math.round(l / 0.2))),
    d = Math.max(8, Math.round(u * o)),
    p = m_Cw(i, u, d),
    g = l / u,
    w = m_Tw(p, s.removeBackground),
    { labels: y, palette: v } = m_o6(p, w, Math.max(1, Math.min(16, s.colors)));
  let j = m_Cb(y, u, d);
  j = m_Cb(j, u, d);
  const k = Math.max(4, Math.round(s.minDetailMm2 / (g * g))),
    x = m_c6(j, u, d, k),
    A = v.map(() => 0);
  for (let le = 0; le < j.length; le++) j[le] >= 0 && A[j[le]]++;
  const C = v
      .map((le, oe) => oe)
      .filter((le) => A[le] > 0)
      .sort((le, oe) => A[oe] - A[le]),
    I = C.map((le, oe) => ({
      rgb: m_i6(...v[le]),
      name: `Couleur ${oe + 1}`,
      brand: "",
      code: "",
    })),
    E = new Int16Array(v.length).fill(-1);
  C.forEach((le, oe) => (E[le] = oe));
  const O = Math.max(0, Math.round(s.overlapMm / g)),
    B = [],
    _ = {
      workWidth: u,
      workHeight: d,
      mmPerPx: g,
      palette: I.map((le) => le.rgb),
      mergedIslands: x,
      droppedRegions: 0,
      objects: [],
    },
    X = 0,
    K = 0;
  let ie = 0;
  C.forEach((le, oe) => {
    const Y = new Uint8Array(u * d);
    for (let te = 0; te < j.length; te++) j[te] === le && (Y[te] = 1);
    if (O > 0) {
      const te = new Uint8Array(Y);
      for (let be = 0; be < j.length; be++) {
        if (Y[be] || j[be] < 0 || E[j[be]] <= oe) continue;
        const Ae = be % u,
          V = (be - Ae) / u;
        let fe = !1;
        for (let ce = -O; ce <= O && !fe; ce++)
          for (let F = -O; F <= O && !fe; F++) {
            if (F * F + ce * ce > O * O) continue;
            const $ = Ae + F,
              ue = V + ce;
            $ >= 0 && ue >= 0 && $ < u && ue < d && Y[ue * u + $] && (fe = !0);
          }
        fe && (te[be] = 1);
      }
      Y.set(te);
    }
    const Z = m_u6(m_f6(Y, u, d));
    for (const te of Z) {
      const be = {
          outer: m_Tb(te.outer, s).map((Te) => ({
            x: X + Te.x * g,
            y: K + Te.y * g,
          })),
          holes: te.holes
            .filter((Te) => Math.abs(m_va(Te)) * g * g >= s.minDetailMm2)
            .map((Te) =>
              m_Tb(Te, s).map((Me) => ({
                x: X + Me.x * g,
                y: K + Me.y * g,
              })),
            ),
        },
        Ae = m_ao(be);
      if (Ae < s.minDetailMm2) {
        _.droppedRegions++;
        continue;
      }
      const V = m_Qd(be),
        fe = m_Sd(be.outer) ** 2 / Math.max(Ae, 1e-6);
      let ce = "fill",
        F = "",
        $;
      if (V < s.runMaxWidthMm) {
        const Te = m_m6(be);
        ((ce = "triple"),
          Te && ($ = Te),
          (F = `largeur ${(V * 2).toFixed(1)} mm : trait fin, point triple ${Te ? "sur la ligne médiane" : "sur le contour"}`));
      } else
        V * 2 <= s.satinMaxWidthMm * 1.2 && be.holes.length === 0 && fe > 18
          ? ((ce = "satin"), (F = `bande étroite (≈${(V * 2).toFixed(1)} mm) : satin`))
          : (F = `surface ${Ae.toFixed(0)} mm² : tatami`);
      const ue = `obj${++ie}`,
        ae = {
          ...DEFAULT_FILL,
          angle: Math.round(((m_pm(be) * 180) / Math.PI + 45 + 180) % 180),
        };
      (B.push({
        id: ue,
        name: `${I[oe].name} · ${ie}`,
        type: ce,
        color: oe,
        shape: be,
        path: $,
        closed: !1,
        fill: ae,
        satin: {
          ...DEFAULT_SATIN,
        },
        run: {
          ...DEFAULT_RUN,
        },
        visible: !0,
      }),
        _.objects.push({
          id: ue,
          color: oe,
          type: ce,
          areaMm2: Ae,
          widthMm: V * 2,
          reason: F,
        }));
    }
  });
  const ne = [];
  for (let le = 0; le < I.length; le++) {
    const oe = B.filter((Z) => Z.color === le);
    let Y = ne.length
      ? ne[ne.length - 1].shape.outer[0]
      : {
          x: 0,
          y: 0,
        };
    for (; oe.length;) {
      let Z = 0,
        te = 1 / 0;
      oe.forEach((Ae, V) => {
        const fe = Ae.shape.outer[0],
          ce = (fe.x - Y.x) ** 2 + (fe.y - Y.y) ** 2;
        ce < te && ((te = ce), (Z = V));
      });
      const be = oe.splice(Z, 1)[0];
      (ne.push(be), (Y = be.shape.outer[0]));
    }
  }
  return {
    design: {
      name: n,
      widthMm: l,
      heightMm: c,
      threads: I,
      objects: ne,
    },
    report: _,
    labels: j,
    work: p,
  };
}
function m_m6(h) {
  const e = m_pm(h),
    n = m_bl(h, -e),
    s = m_Of(n.outer),
    i = [],
    o = Math.max(0.3, (s.maxX - s.minX) / 200);
  for (let l = s.minX + o / 2; l < s.maxX; l += o) {
    const c = m_gw(m_bl(n, Math.PI / 2), l);
    if (c.length !== 1) {
      if (c.length > 1) return null;
      continue;
    }
    const [u, d] = c[0];
    i.push(
      m_lo(
        {
          x: l,
          y: -(u + d) / 2,
        },
        e,
      ),
    );
  }
  return i.length < 2 ? null : simplifyPath(i, 0.05);
}
const PEC_PALETTE = m_jm.flatMap((h) =>
    h
      ? [
          {
            brand: "Brother (palette PEC)",
            code: h[2],
            name: h[1],
            rgb: "#" + h[0].toString(16).padStart(6, "0"),
          },
        ]
      : [],
  ),
  CHART_BRANDS = ["Madeira", "Isacord", "Sulky", "Robison-Anton"];
function m_Mb(h) {
  const e = parseInt(h.slice(1), 16);
  return [(e >> 16) & 255, (e >> 8) & 255, e & 255];
}
function m_g6(h, e) {
  const [n, s, i] = m_Mb(h),
    [o, l, c] = m_Mb(e),
    u = (n + o) / 2,
    d = n - o,
    p = s - l,
    g = i - c;
  return ((512 + u) * d * d) / 256 + 4 * p * p + ((767 - u) * g * g) / 256;
}
function nearestPecThread(h, e = PEC_PALETTE) {
  let n = e[0],
    s = 1 / 0;
  for (const i of e) {
    const o = m_g6(h, i.rgb);
    o < s && ((s = o), (n = i));
  }
  return n;
}
function threadFromChartEntry(h) {
  return {
    rgb: h.rgb,
    name: h.name,
    brand: h.brand,
    code: h.code,
  };
}
function m_w6(h, e) {
  const n = parseInt(h.slice(1), 16),
    s = (i) => Math.max(0, Math.min(255, Math.round(e >= 0 ? i + (255 - i) * e : i * (1 + e))));
  return `rgb(${s((n >> 16) & 255)},${s((n >> 8) & 255)},${s(n & 255)})`;
}
function stitchThreadIndex(h) {
  const e = new Int16Array(h.stitches.length);
  let n = 0;
  return (
    h.stitches.forEach((s, i) => {
      (s.c === COLOR_CHANGE && n++, (e[i] = n));
    }),
    e
  );
}
function m_y6(h, e) {
  const n = ((Math.atan2(e, h) * 180) / Math.PI + 180) % 180;
  return `hsl(${Math.round(n * 2)},75%,48%)`;
}
const m_v6 = {
  fill: "#3f8fd8",
  satin: "#e0702e",
  satinBorder: "#e0702e",
  zigzag: "#d6a320",
  running: "#2e9e63",
  triple: "#2e9e63",
  bean: "#2e9e63",
  applique: "#a35bd6",
};
function renderPlan(h, e, n, s) {
  const i = Math.min(e.stitches.length, s.upto ?? e.stitches.length),
    o = stitchThreadIndex(e),
    l = s.mode ?? "thread",
    c = Math.max(0.9, 0.4 * n.scale);
  ((h.lineCap = "round"), (h.lineJoin = "round"));
  const u = (w) => w.x * n.scale + n.ox,
    d = (w) => w.y * n.scale + n.oy,
    p = [];
  for (let w = 1; w < i; w++) {
    const y = e.stitches[w - 1],
      v = e.stitches[w];
    y.c === STITCH &&
      v.c === STITCH &&
      (y.x !== v.x || y.y !== v.y) &&
      p.push({
        i: w,
        a: y,
        b: v,
      });
  }
  const g = (w) => (s.dimColor != null && s.dimColor !== o[w] ? 0.15 : 1);
  if (l === "thread" && s.realistic) {
    const w = {
      x: -0.62,
      y: -0.78,
    };
    ((h.strokeStyle = "rgba(0,0,0,0.22)"), (h.lineWidth = c * 1.15), h.beginPath());
    const y = Math.max(0.6, 0.06 * n.scale);
    for (const v of p) g(v.i) < 1 || (h.moveTo(u(v.a) + y, d(v.a) + y), h.lineTo(u(v.b) + y, d(v.b) + y));
    h.stroke();
    for (const v of [0, 1]) {
      const j = new Map();
      for (const k of p) {
        const x = e.threads[o[k.i]] ?? e.threads[e.threads.length - 1],
          A = x ? x.rgb : "#888888",
          C = k.b.x - k.a.x,
          I = k.b.y - k.a.y,
          E = Math.hypot(C, I) || 1,
          O = Math.abs((C / E) * w.y - (I / E) * w.x),
          B = Math.round(O * 3),
          _ = v === 0 ? -0.18 + B * 0.04 : 0.18 + B * 0.12,
          X = `${m_w6(A, _)}|${g(k.i)}`;
        let K = j.get(X);
        if ((K || ((K = new Path2D()), j.set(X, K)), v === 0))
          (K.moveTo(u(k.a), d(k.a)), K.lineTo(u(k.b), d(k.b)));
        else {
          const ie = -0.08 * n.scale,
            ne = u(k.a) + (u(k.b) - u(k.a)) * 0.18,
            ge = d(k.a) + (d(k.b) - d(k.a)) * 0.18,
            le = u(k.a) + (u(k.b) - u(k.a)) * 0.82,
            oe = d(k.a) + (d(k.b) - d(k.a)) * 0.82;
          (K.moveTo(ne + ie * 0.6, ge + ie * 0.8), K.lineTo(le + ie * 0.6, oe + ie * 0.8));
        }
      }
      h.lineWidth = v === 0 ? c : c * 0.3;
      for (const [k, x] of j) {
        const [A, C] = k.split("|");
        ((h.strokeStyle = A), (h.globalAlpha = Number(C) * (v === 0 ? 1 : 0.85)), h.stroke(x));
      }
      h.globalAlpha = 1;
    }
    if (n.scale > 7) {
      h.fillStyle = "rgba(0,0,0,0.28)";
      const v = Math.max(0.6, 0.07 * n.scale);
      for (const j of p) (h.beginPath(), h.arc(u(j.b), d(j.b), v, 0, Math.PI * 2), h.fill());
    }
  } else if (l === "thread") {
    let w = -1;
    h.beginPath();
    for (const y of p) {
      if (o[y.i] !== w) {
        (h.stroke(), (w = o[y.i]));
        const v = e.threads[w] ?? e.threads[e.threads.length - 1];
        ((h.strokeStyle = v ? v.rgb : "#888"),
          (h.globalAlpha = g(y.i)),
          (h.lineWidth = Math.max(0.8, c * 0.5)),
          h.beginPath());
      }
      (h.moveTo(u(y.a), d(y.a)), h.lineTo(u(y.b), d(y.b)));
    }
    (h.stroke(), (h.globalAlpha = 1));
  } else if (l === "directions" || l === "types") {
    const w = new Map();
    for (const y of p) {
      const v =
        l === "directions"
          ? m_y6(y.b.x - y.a.x, y.b.y - y.a.y)
          : (m_v6[s.objectTypes?.[y.b.obj ?? -1] ?? ""] ?? "#888");
      let j = w.get(v);
      (j || ((j = new Path2D()), w.set(v, j)), j.moveTo(u(y.a), d(y.a)), j.lineTo(u(y.b), d(y.b)));
    }
    h.lineWidth = Math.max(0.8, c * 0.45);
    for (const [y, v] of w) ((h.strokeStyle = y), h.stroke(v));
  } else if (l === "density") {
    const w = new Map();
    for (let y = 0; y < i; y++) {
      const v = e.stitches[y];
      if (v.c !== STITCH) continue;
      const j = `${Math.floor(v.x)},${Math.floor(v.y)}`;
      w.set(j, (w.get(j) ?? 0) + 1);
    }
    for (const [y, v] of w) {
      const [j, k] = y.split(",").map(Number),
        x = Math.min(1, v / 18);
      ((h.fillStyle =
        v > 18
          ? "rgba(220,30,60,0.85)"
          : v > 10
            ? `rgba(240,150,40,${0.45 + 0.4 * x})`
            : `rgba(60,140,220,${0.15 + 0.5 * x})`),
        h.fillRect(j * n.scale + n.ox, k * n.scale + n.oy, n.scale + 0.5, n.scale + 0.5));
    }
  }
  if (s.showJumps) {
    (h.setLineDash([3, 4]), (h.strokeStyle = "rgba(230,80,80,0.75)"), (h.lineWidth = 1), h.beginPath());
    let w = null;
    for (let y = 0; y < i; y++) {
      const v = e.stitches[y];
      (v.c === JUMP && w && (h.moveTo(u(w), d(w)), h.lineTo(u(v), d(v))),
        (v.c === STITCH || v.c === JUMP) && (w = v));
    }
    (h.stroke(), h.setLineDash([]), (h.strokeStyle = "rgba(230,60,60,0.9)"), (h.lineWidth = 1.5));
    for (let y = 0; y < i; y++) {
      const v = e.stitches[y];
      if (v.c !== 2) continue;
      const j = u(v),
        k = d(v);
      (h.beginPath(),
        h.moveTo(j - 4, k - 4),
        h.lineTo(j + 4, k + 4),
        h.moveTo(j - 4, k + 4),
        h.lineTo(j + 4, k - 4),
        h.stroke());
    }
  }
  if (s.highlight) {
    ((h.strokeStyle = "rgba(255,200,40,0.9)"), (h.lineWidth = Math.max(1.2, c * 0.5)), h.beginPath());
    for (let w = Math.max(1, s.highlight.start + 1); w < Math.min(i, s.highlight.end); w++) {
      const y = e.stitches[w - 1],
        v = e.stitches[w];
      y.c === STITCH && v.c === STITCH && (h.moveTo(u(y), d(y)), h.lineTo(u(v), d(v)));
    }
    h.stroke();
  }
}
let m_Bd = null;
function fabricPattern(h, e, n) {
  const s = e + Math.round(n * 4);
  if (m_Bd?.key === s) return m_Bd.pat;
  const i = document.createElement("canvas"),
    o = Math.max(2, n * 0.45);
  i.width = i.height = Math.round(o * 8);
  const l = i.getContext("2d");
  ((l.fillStyle = e), l.fillRect(0, 0, i.width, i.height), (l.globalAlpha = 0.07));
  for (let u = 0; u < 8; u++)
    ((l.fillStyle = u % 2 ? "#000" : "#fff"),
      l.fillRect(0, u * o, i.width, o * 0.5),
      l.fillRect(u * o, 0, o * 0.5, i.height));
  const c = h.createPattern(i, "repeat");
  return (
    (m_Bd = {
      key: s,
      pat: c,
    }),
    c
  );
}
function planBounds(h) {
  let e = 1 / 0,
    n = 1 / 0,
    s = -1 / 0,
    i = -1 / 0;
  for (const o of h.stitches)
    o.c === STITCH &&
      (o.x < e && (e = o.x), o.y < n && (n = o.y), o.x > s && (s = o.x), o.y > i && (i = o.y));
  return isFinite(e)
    ? {
        minX: e,
        minY: n,
        maxX: s,
        maxY: i,
      }
    : {
        minX: 0,
        minY: 0,
        maxX: 1,
        maxY: 1,
      };
}
function planToSvg(h, e) {
  const n = planBounds(h),
    s = 2,
    i = n.maxX - n.minX + s * 2,
    o = n.maxY - n.minY + s * 2,
    l = stitchThreadIndex(h),
    c = [];
  let u = -1,
    d = "";
  const p = () => {
    (d && c.push(`<path d="${d}" stroke="${h.threads[u]?.rgb ?? "#000"}" />`), (d = ""));
  };
  for (let w = 1; w < h.stitches.length; w++) {
    const y = h.stitches[w - 1],
      v = h.stitches[w];
    y.c !== STITCH ||
      v.c !== STITCH ||
      (l[w] !== u && (p(), (u = l[w])),
      (d += `M${(y.x - n.minX + s).toFixed(2)} ${(y.y - n.minY + s).toFixed(2)}L${(v.x - n.minX + s).toFixed(2)} ${(v.y - n.minY + s).toFixed(2)}`));
  }
  p();
  const g = e.replace(/[<&>"]/g, "");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${i.toFixed(1)}mm" height="${o.toFixed(1)}mm" viewBox="0 0 ${i.toFixed(2)} ${o.toFixed(2)}"><title>${g} — aperçu StitchStudio AI</title><g fill="none" stroke-width="0.3" stroke-linecap="round">${c.join("")}</g></svg>`;
}
function planToPngBlob(h, e = 8) {
  const n = planBounds(h),
    s = 3,
    i = document.createElement("canvas");
  ((i.width = Math.ceil((n.maxX - n.minX + s * 2) * e)),
    (i.height = Math.ceil((n.maxY - n.minY + s * 2) * e)));
  const o = i.getContext("2d");
  return (
    (o.fillStyle = "#f4efe6"),
    o.fillRect(0, 0, i.width, i.height),
    renderPlan(
      o,
      h,
      {
        scale: e,
        ox: (s - n.minX) * e,
        oy: (s - n.minY) * e,
      },
      {
        realistic: !0,
        showJumps: !1,
      },
    ),
    new Promise((l) => i.toBlob((c) => l(c), "image/png"))
  );
}
const MAX_IMAGE_PX = 1600;
function rasterizeImage(h, e, n) {
  const s = Math.min(1, MAX_IMAGE_PX / Math.max(e, n)),
    i = Math.max(1, Math.round(e * s)),
    o = Math.max(1, Math.round(n * s)),
    l = document.createElement("canvas");
  ((l.width = i), (l.height = o));
  const c = l.getContext("2d", {
    willReadFrequently: !0,
  });
  c.drawImage(h, 0, 0, i, o);
  const u = c.getImageData(0, 0, i, o);
  return {
    width: i,
    height: o,
    data: u.data,
  };
}
async function loadImageUrl(h, e) {
  const n = new Image();
  ((n.decoding = "async"), (n.src = h), await n.decode());
  let s = n.naturalWidth || 800,
    i = n.naturalHeight || 800;
  if (e) {
    const o = 1200 / Math.max(s, i);
    ((s *= o), (i *= o));
  }
  return rasterizeImage(n, s, i);
}
function imageToDataUrl(h) {
  const e = document.createElement("canvas");
  ((e.width = h.width), (e.height = h.height));
  const n = e.getContext("2d"),
    s = n.createImageData(h.width, h.height);
  return (s.data.set(h.data), n.putImageData(s, 0, 0), e.toDataURL("image/png"));
}
const m_E6 = (() => {
  const h = new Uint32Array(256);
  for (let e = 0; e < 256; e++) {
    let n = e;
    for (let s = 0; s < 8; s++) n = n & 1 ? 3988292384 ^ (n >>> 1) : n >>> 1;
    h[e] = n >>> 0;
  }
  return h;
})();
function m_F6(h) {
  let e = 4294967295;
  for (let n = 0; n < h.length; n++) e = m_E6[(e ^ h[n]) & 255] ^ (e >>> 8);
  return (e ^ 4294967295) >>> 0;
}
function zipSingleFile(h, e) {
  const n = new TextEncoder().encode(h),
    s = m_F6(e),
    i = new Uint8Array(30 + n.length + e.length + 46 + n.length + 22),
    o = new DataView(i.buffer);
  let l = 0;
  const c = (g) => {
      (o.setUint32(l, g, !0), (l += 4));
    },
    u = (g) => {
      (o.setUint16(l, g, !0), (l += 2));
    };
  (c(67324752),
    u(20),
    u(2048),
    u(0),
    u(0),
    u(33),
    c(s),
    c(e.length),
    c(e.length),
    u(n.length),
    u(0),
    i.set(n, l),
    (l += n.length),
    i.set(e, l),
    (l += e.length));
  const d = l;
  (c(33639248),
    u(20),
    u(20),
    u(2048),
    u(0),
    u(0),
    u(33),
    c(s),
    c(e.length),
    c(e.length),
    u(n.length),
    u(0),
    u(0),
    u(0),
    u(0),
    c(0),
    c(0),
    i.set(n, l),
    (l += n.length));
  const p = l - d;
  return (c(101010256), u(0), u(0), u(1), u(1), c(p), c(d), u(0), i);
}
const QC_LABELS = {
  "hoop.overflow": ["Dépasse le cadre", "Past niet in het raam", "Exceeds hoop", "يتجاوز الإطار"],
  "hoop.unconfirmed": [
    "Cadre à confirmer",
    "Raam te bevestigen",
    "Hoop to confirm",
    "الإطار بحاجة إلى تأكيد",
  ],
  "machine.unverified": [
    "Machine non vérifiée",
    "Machine niet geverifieerd",
    "Machine not verified",
    "آلة غير موثقة",
  ],
  "stitch.tooLong": ["Points trop longs", "Te lange steken", "Stitches too long", "غرز طويلة جدًا"],
  "satin.tooWide": ["Satin trop large", "Satijn te breed", "Satin too wide", "ساتان عريض جدًا"],
  "density.high": ["Densité excessive", "Te hoge dichtheid", "Excessive density", "كثافة مفرطة"],
  "density.local": ["Densité locale", "Lokale dichtheid", "Local density", "كثافة موضعية"],
  "stitch.duplicate": ["Points superposés", "Overlappende steken", "Overlapping stitches", "غرز متراكبة"],
  "contour.invalid": ["Contours à vérifier", "Contouren controleren", "Check contours", "تحقق من الحدود"],
  "detail.small": ["Détails trop petits", "Te kleine details", "Details too small", "تفاصيل صغيرة جدًا"],
  "jump.many": ["Beaucoup de coupes", "Veel knipbeurten", "Many trims", "قصات كثيرة"],
  "jump.long": ["Longs déplacements", "Lange sprongen", "Long jumps", "قفزات طويلة"],
  "color.redundant": ["Changements inutiles", "Onnodige wissels", "Redundant changes", "تغييرات غير ضرورية"],
  "color.regroup": ["Couleurs à regrouper", "Kleuren groeperen", "Colors to group", "ألوان للتجميع"],
  "color.pesLimit": ["Limite PES", "PES-limiet", "PES limit", "حد PES"],
  "pullcomp.low": ["Compensation faible", "Lage compensatie", "Low compensation", "تعويض منخفض"],
  "design.empty": ["Motif vide", "Leeg motief", "Empty design", "تصميم فارغ"],
  "hoop.margin": ["Marge au cadre", "Marge tot raam", "Hoop margin", "هامش الإطار"],
  "density.block": ["Densité dangereuse", "Gevaarlijke dichtheid", "Dangerous density", "كثافة خطرة"],
  "stitch.short": ["Points trop courts", "Te korte steken", "Stitches too short", "غرز قصيرة جدًا"],
  "stitch.long": ["Points longs", "Lange steken", "Long stitches", "غرز طويلة"],
  "stitch.pile": ["Accumulation de points", "Opgehoopte steken", "Stitch pile-up", "تراكم الغرز"],
  "underlay.missing": [
    "Sous-couche manquante",
    "Onderlaag ontbreekt",
    "Missing underlay",
    "طبقة سفلية مفقودة",
  ],
  "underlay.weak": ["Sous-couche légère", "Lichte onderlaag", "Light underlay", "طبقة سفلية خفيفة"],
  "pullcomp.high": ["Compensation forte", "Hoge compensatie", "High compensation", "تعويض مرتفع"],
  "objects.overlap": ["Remplissages superposés", "Overlappende vullingen", "Stacked fills", "تعبئات متراكبة"],
  "machine.limits": ["Limites machine", "Machinelimieten", "Machine limits", "حدود الآلة"],
};
const DEMO_MOTIFS = [
    "01-chat",
    "02-fleur",
    "03-papillon",
    "04-logo",
    "05-prenom",
    "06-motif-arabe",
    "07-geometrique",
    "08-illustration",
  ],
  DEMO_COLORS = {
    "01-chat": 5,
    "02-fleur": 5,
    "03-papillon": 5,
    "04-logo": 3,
    "05-prenom": 4,
    "06-motif-arabe": 4,
    "07-geometrique": 4,
    "08-illustration": 9,
  },
  STITCH_TYPES = ["fill", "satin", "satinBorder", "zigzag", "running", "triple", "bean", "applique"];
function m_V6(h, e) {
  return {
    outer: h.outer.map(e),
    holes: h.holes.map((n) => n.map(e)),
  };
}
function mapObjectPoints(h, e) {
  return {
    ...h,
    shape: m_V6(h.shape, e),
    path: h.path?.map(e),
  };
}
function objectBounds(h) {
  return m_Of(h.path ?? h.shape.outer);
}
function objectCenter(h) {
  const e = objectBounds(h);
  return {
    x: (e.minX + e.maxX) / 2,
    y: (e.minY + e.maxY) / 2,
  };
}
function hitTestObject(h, e, n) {
  for (let s = h.objects.length - 1; s >= 0; s--) {
    const i = h.objects[s];
    if (i.visible) {
      if (i.path) {
        for (let o = 1; o < i.path.length; o++)
          if (pointSegmentDistance(e, i.path[o - 1], i.path[o]) < Math.max(n, i.satin.width / 2)) return i;
      } else if (m_wl(e, i.shape)) return i;
    }
  }
  return null;
}
function pointSegmentDistance(h, e, n) {
  const s = n.x - e.x,
    i = n.y - e.y,
    o = s * s + i * i,
    l = o ? Math.max(0, Math.min(1, ((h.x - e.x) * s + (h.y - e.y) * i) / o)) : 0;
  return Math.hypot(h.x - e.x - l * s, h.y - e.y - l * i);
}
const createObject = (h, e, n, s, i) => ({
  id: h,
  name: h,
  type: e,
  color: n,
  shape: s,
  path: i,
  closed: !1,
  fill: {
    ...DEFAULT_FILL,
  },
  satin: {
    ...DEFAULT_SATIN,
  },
  run: {
    ...DEFAULT_RUN,
  },
  visible: !0,
});
export {
  STITCH,
  JUMP,
  TRIM,
  END,
  COLOR_CHANGE,
  DEFAULT_FILL,
  DEFAULT_SATIN,
  DEFAULT_RUN,
  DEFAULT_TRACE_OPTIONS,
  QC_THRESHOLDS,
  FORMAT_LIMITS,
  STITCH_TYPES,
  traceImage,
  buildPlan,
  computeStats,
  runQualityChecks,
  stitchThreadIndex,
  writePES1,
  writePES6,
  writeDST,
  zipSingleFile,
  MACHINES,
  PEC_PALETTE,
  CHART_BRANDS,
  PEC_CHART,
  PENDING_CHARTS,
  nearestPecThread,
  threadFromChartEntry,
  matchChartEntries,
  parseChartCsv,
  distance,
  simplifyPath,
  createObject,
  mapObjectPoints,
  objectBounds,
  objectCenter,
  hitTestObject,
  pointSegmentDistance,
  renderPlan,
  fabricPattern,
  planToSvg,
  planToPngBlob,
  planBounds,
  LANG_INDEX,
  QC_LABELS,
  translateIssue,
  translateStrategy,
  translateHoopSource,
  translateMachineNote,
  translateChartSource,
  REGISTRY_FILES,
  REFERENCE_FINGERPRINTS_FILE,
  summarizeRegistry,
  registryFileStatus,
  sha256Hex,
  MAX_IMAGE_PX,
  rasterizeImage,
  loadImageUrl,
  imageToDataUrl,
  DEMO_MOTIFS,
  DEMO_COLORS,
};
