/* ============================================================
   ZACH JONES — live telemetry engine
   Vanilla JS, no libraries. Everything on this page that moves
   is driven from here.
   ============================================================ */
(function () {
    "use strict";

    var reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    var clamp = function (v, lo, hi) { return Math.min(hi, Math.max(lo, v)); };
    var lerp = function (a, b, t) { return a + (b - a) * t; };

    /* ============ shared visitor state ============ */

    var state = {
        cursorX: null, cursorY: null,
        cursorVel: 0,        // smoothed px/s
        cursorVelRaw: 0,
        cursorDist: 0,       // total px travelled
        scrollVel: 0,        // smoothed px/s
        scrollVelRaw: 0,
        lastScrollY: window.scrollY,
        activity: 0,         // decaying event energy -> "rpm"
        ignition: false,     // gauges live after startup sweep
        lapStart: null
    };

    document.addEventListener("pointermove", function (e) {
        if (state.cursorX !== null) {
            var dx = e.clientX - state.cursorX;
            var dy = e.clientY - state.cursorY;
            var d = Math.sqrt(dx * dx + dy * dy);
            state.cursorDist += d;
            state._pendingCursor = (state._pendingCursor || 0) + d;
        }
        state.cursorX = e.clientX;
        state.cursorY = e.clientY;
        state.activity += 6;
    }, { passive: true });

    ["scroll", "keydown", "click", "touchmove"].forEach(function (ev) {
        window.addEventListener(ev, function () { state.activity += ev === "scroll" ? 3 : 18; }, { passive: true });
    });

    /* ============ gauge construction ============ */
    /* 240° sweep, from 210° (min) clockwise to 330°->-30° (max) */

    var GAUGE_START = -120; // degrees, relative to 12 o'clock
    var GAUGE_SWEEP = 240;

    function polar(cx, cy, r, deg) {
        var rad = (deg - 90) * Math.PI / 180; // 0° = 12 o'clock after -90 shift... we pass absolute
        return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
    }

    function buildGauge(container, opts) {
        var NS = "http://www.w3.org/2000/svg";
        var svg = document.createElementNS(NS, "svg");
        svg.setAttribute("viewBox", "0 0 120 110");
        var cx = 60, cy = 58, r = 46;

        // background arc
        var a0 = GAUGE_START, a1 = GAUGE_START + GAUGE_SWEEP;
        var p0 = polar(cx, cy, r, a0), p1 = polar(cx, cy, r, a1);
        var arc = document.createElementNS(NS, "path");
        arc.setAttribute("d", "M " + p0.x + " " + p0.y + " A " + r + " " + r + " 0 1 1 " + p1.x + " " + p1.y);
        arc.setAttribute("class", "gauge-arc");
        svg.appendChild(arc);

        // hot zone (last 25% of range)
        var h0 = polar(cx, cy, r, a0 + GAUGE_SWEEP * 0.75);
        var hot = document.createElementNS(NS, "path");
        hot.setAttribute("d", "M " + h0.x + " " + h0.y + " A " + r + " " + r + " 0 0 1 " + p1.x + " " + p1.y);
        hot.setAttribute("class", "gauge-arc-hot");
        svg.appendChild(hot);

        // ticks + numerals
        var majors = opts.majors; // e.g. [0,2,4,6,8]
        var steps = (majors.length - 1) * 2; // minor between each major
        for (var i = 0; i <= steps; i++) {
            var frac = i / steps;
            var ang = a0 + frac * GAUGE_SWEEP;
            var isMajor = i % 2 === 0;
            var rOuter = r + 1;
            var rInner = isMajor ? r - 8 : r - 5;
            var o = polar(cx, cy, rOuter, ang), n = polar(cx, cy, rInner, ang);
            var tick = document.createElementNS(NS, "line");
            tick.setAttribute("x1", o.x); tick.setAttribute("y1", o.y);
            tick.setAttribute("x2", n.x); tick.setAttribute("y2", n.y);
            tick.setAttribute("class", isMajor ? "gauge-tick-major" : "gauge-tick");
            svg.appendChild(tick);
            if (isMajor) {
                var tp = polar(cx, cy, r - 17, ang);
                var num = document.createElementNS(NS, "text");
                num.setAttribute("x", tp.x); num.setAttribute("y", tp.y + 3);
                num.setAttribute("class", "gauge-num");
                num.textContent = majors[i / 2];
                svg.appendChild(num);
            }
        }

        // needle
        var needle = document.createElementNS(NS, "line");
        var tip = polar(cx, cy, r - 10, a0);
        var tail = polar(cx, cy, -10, a0);
        needle.setAttribute("x1", tail.x); needle.setAttribute("y1", tail.y);
        needle.setAttribute("x2", tip.x); needle.setAttribute("y2", tip.y);
        needle.setAttribute("class", "gauge-needle");
        svg.appendChild(needle);

        var hub = document.createElementNS(NS, "circle");
        hub.setAttribute("cx", cx); hub.setAttribute("cy", cy); hub.setAttribute("r", 4.5);
        hub.setAttribute("class", "gauge-hub");
        svg.appendChild(hub);

        container.appendChild(svg);

        var shown = 0; // smoothed needle fraction 0..1
        return {
            max: opts.max,
            set: function (frac) {
                shown = lerp(shown, clamp(frac, 0, 1.04), 0.18);
                var deg = shown * GAUGE_SWEEP;
                needle.setAttribute("transform", "rotate(" + deg + " " + cx + " " + cy + ")");
            },
            snap: function (frac) {
                shown = clamp(frac, 0, 1.04);
                var deg = shown * GAUGE_SWEEP;
                needle.setAttribute("transform", "rotate(" + deg + " " + cx + " " + cy + ")");
            }
        };
    }

    var gauges = {};
    var gaugeDefs = {
        scroll:   { majors: [0, 1, 2, 3, 4], max: 4000, label: "k" },   // px/s, majors in thousands
        cursor:   { majors: [0, 1, 2, 3, 4], max: 4000, label: "k" },
        activity: { majors: [0, 2, 4, 6, 8], max: 8000, label: "krpm" }
    };
    document.querySelectorAll(".gauge").forEach(function (el) {
        var key = el.getAttribute("data-gauge");
        gauges[key] = buildGauge(el.querySelector(".gauge-face"), gaugeDefs[key]);
    });

    var outs = {
        scroll: document.querySelector('[data-out="scroll"]'),
        cursor: document.querySelector('[data-out="cursor"]'),
        activity: document.querySelector('[data-out="activity"]')
    };

    /* ============ strip-chart waveform ============ */

    var waveCanvas = document.getElementById("wave-canvas");
    var waveCtx = waveCanvas ? waveCanvas.getContext("2d") : null;
    var waveA = [], waveB = [], waveLen = 0;

    function sizeWave() {
        if (!waveCanvas) return;
        var dpr = window.devicePixelRatio || 1;
        var rect = waveCanvas.getBoundingClientRect();
        waveCanvas.width = Math.max(1, Math.round(rect.width * dpr));
        waveCanvas.height = Math.max(1, Math.round(rect.height * dpr));
        waveCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
        waveLen = Math.floor(rect.width / 2);
    }

    function drawWave() {
        if (!waveCtx) return;
        var rect = waveCanvas.getBoundingClientRect();
        var w = rect.width, h = rect.height;
        waveCtx.clearRect(0, 0, w, h);

        // grid
        waveCtx.strokeStyle = "rgba(238,241,242,0.09)";
        waveCtx.lineWidth = 1;
        waveCtx.beginPath();
        for (var gx = 0; gx < w; gx += 24) { waveCtx.moveTo(gx + 0.5, 0); waveCtx.lineTo(gx + 0.5, h); }
        for (var gy = 0; gy < h; gy += 22) { waveCtx.moveTo(0, gy + 0.5); waveCtx.lineTo(w, gy + 0.5); }
        waveCtx.stroke();

        function trace(arr, color) {
            if (arr.length < 2) return;
            waveCtx.strokeStyle = color;
            waveCtx.lineWidth = 1.8;
            waveCtx.beginPath();
            for (var i = 0; i < arr.length; i++) {
                var x = w - (arr.length - 1 - i) * 2;
                var y = h - 6 - clamp(arr[i], 0, 1) * (h - 16);
                if (i === 0) waveCtx.moveTo(x, y); else waveCtx.lineTo(x, y);
            }
            waveCtx.stroke();
        }
        trace(waveA, "#F58A2F"); // cursor
        trace(waveB, "#86B9CE"); // scroll
    }

    /* ============ odometer ============ */

    var ODO_DIGITS = 6;
    var odoEl = document.getElementById("odometer");
    var odoStrips = [];
    if (odoEl) {
        for (var d = 0; d < ODO_DIGITS; d++) {
            var col = document.createElement("span");
            col.className = "odo-digit";
            var strip = document.createElement("span");
            strip.className = "odo-strip";
            for (var n = 0; n <= 9; n++) {
                var s = document.createElement("span");
                s.textContent = n;
                strip.appendChild(s);
            }
            col.appendChild(strip);
            odoEl.appendChild(col);
            odoStrips.push(strip);
        }
    }
    var odoShown = -1;
    function updateOdometer() {
        var val = Math.min(Math.round(state.cursorDist), Math.pow(10, ODO_DIGITS) - 1);
        if (val === odoShown) return;
        odoShown = val;
        var str = String(val).padStart(ODO_DIGITS, "0");
        for (var i = 0; i < ODO_DIGITS; i++) {
            odoStrips[i].style.transform = "translateY(-" + (+str[i]) * 16 + "px)";
        }
    }

    /* ============ track map ============ */

    var circuit = document.getElementById("circuit");
    var trackDot = document.getElementById("track-dot");
    var trackLen = circuit ? circuit.getTotalLength() : 0;
    var trackSvg = document.getElementById("trackmap");

    // clickable sector markers at each section's scroll position
    var sections = Array.prototype.slice.call(document.querySelectorAll("main section[id]"));
    function placeMarkers() {
        if (!trackSvg || !trackLen) return;
        Array.prototype.slice.call(trackSvg.querySelectorAll(".track-marker")).forEach(function (m) { m.remove(); });
        var docH = document.documentElement.scrollHeight - window.innerHeight;
        sections.forEach(function (sec) {
            if (!docH) return;
            var frac = clamp(sec.offsetTop / docH, 0, 1);
            var pt = circuit.getPointAtLength(frac * trackLen);
            var m = document.createElementNS("http://www.w3.org/2000/svg", "circle");
            m.setAttribute("cx", pt.x); m.setAttribute("cy", pt.y); m.setAttribute("r", 2);
            m.setAttribute("class", "track-marker");
            trackSvg.insertBefore(m, trackDot);
        });
    }

    function updateTrackDot() {
        if (!trackDot || !trackLen) return;
        var docH = document.documentElement.scrollHeight - window.innerHeight;
        var frac = docH ? clamp(window.scrollY / docH, 0, 1) : 0;
        var pt = circuit.getPointAtLength(frac * trackLen);
        trackDot.setAttribute("cx", pt.x);
        trackDot.setAttribute("cy", pt.y);
    }

    /* ============ sector (current section) readout ============ */

    var sectorOut = document.getElementById("hud-sector");
    var sectorNames = { services: "S1 · SERVICES", work: "S2 · SESSION LOG", driver: "S3 · DRIVER", contact: "S4 · RADIO" };
    if ("IntersectionObserver" in window && sectorOut) {
        var sectorObs = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) sectorOut.textContent = sectorNames[e.target.id] || "GRID";
            });
        }, { rootMargin: "-40% 0px -50% 0px" });
        sections.forEach(function (s) { sectorObs.observe(s); });
    }

    /* ============ lap timer + hud readouts ============ */

    var lapOut = document.getElementById("hud-lap");
    var velOut = document.getElementById("hud-vel");
    function formatLap(ms) {
        var m = Math.floor(ms / 60000);
        var s = Math.floor((ms % 60000) / 1000);
        var t = Math.floor((ms % 1000) / 100);
        return m + ":" + String(s).padStart(2, "0") + "." + t;
    }

    /* ============ UTC clock ============ */

    var clockEl = document.getElementById("utc-clock");
    function tickClock() {
        if (!clockEl) return;
        var now = new Date();
        clockEl.textContent =
            String(now.getUTCHours()).padStart(2, "0") + ":" +
            String(now.getUTCMinutes()).padStart(2, "0") + ":" +
            String(now.getUTCSeconds()).padStart(2, "0");
    }
    tickClock();
    setInterval(tickClock, 1000);

    /* ============ stack ticker ============ */

    var STACK = ["JAVASCRIPT", "TYPESCRIPT", "C#", ".NET", "SQL SERVER", "AWS", "PYTHON",
        "JAVA", "C", "C++", "QT", "ANGULAR", "HTML5", "CSS3", "GIT", "CI/CD", "LINUX",
        "RASPBERRY PI", "HASKELL", "DART"];
    var tickerTrack = document.getElementById("ticker-track");
    if (tickerTrack) {
        var half = STACK.map(function (s) {
            return "<span>" + s + "</span><span class=\"tick-sep\">◆</span>";
        }).join("");
        tickerTrack.innerHTML = half + half; // duplicate for seamless -50% loop
    }

    /* ============ text scramble (eyebrows) ============ */

    var SCRAMBLE_CHARS = "▮▯/\\|<>=+-·01";
    function scramble(el) {
        if (reducedMotion) return;
        var finalText = el.textContent;
        var frame = 0, total = Math.max(20, finalText.length * 2);
        function step() {
            frame++;
            var done = Math.floor((frame / total) * finalText.length);
            var out = "";
            for (var i = 0; i < finalText.length; i++) {
                if (i < done || finalText[i] === " ") out += finalText[i];
                else out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
            }
            el.textContent = out;
            if (done < finalText.length) requestAnimationFrame(step);
            else el.textContent = finalText;
        }
        requestAnimationFrame(step);
    }

    /* ============ scroll reveals ============ */

    if ("IntersectionObserver" in window && !reducedMotion) {
        var revealObs = new IntersectionObserver(function (entries) {
            entries.forEach(function (e) {
                if (e.isIntersecting) {
                    e.target.classList.add("on");
                    revealObs.unobserve(e.target);
                }
            });
        }, { threshold: 0.12 });
        document.querySelectorAll(".reveal").forEach(function (el) { revealObs.observe(el); });
    } else {
        document.querySelectorAll(".reveal").forEach(function (el) { el.classList.add("on"); });
    }

    /* ============ ignition sequence ============ */

    var sysStatus = document.getElementById("sys-status");
    function ignition() {
        var body = document.body;
        var plateSpans = document.querySelectorAll(".plate-word span");
        plateSpans.forEach(function (s, i) { s.style.transitionDelay = (i * 55) + "ms"; });

        if (reducedMotion) {
            body.classList.remove("preignition");
            state.ignition = true;
            state.lapStart = performance.now();
            if (sysStatus) sysStatus.textContent = "ALL SYSTEMS GO";
            return;
        }

        // needle sweep: 0 -> max -> 0 over ~1.2s, then go live
        var t0 = performance.now();
        var SWEEP_MS = 1200;
        function sweep(now) {
            var t = (now - t0) / SWEEP_MS;
            if (t >= 1) {
                Object.keys(gauges).forEach(function (k) { gauges[k].snap(0); });
                body.classList.remove("preignition");
                state.ignition = true;
                state.lapStart = performance.now();
                if (sysStatus) sysStatus.textContent = "ALL SYSTEMS GO";
                return;
            }
            var frac = t < 0.5 ? (t / 0.5) : (1 - (t - 0.5) / 0.5); // up then down
            var eased = frac * frac * (3 - 2 * frac); // smoothstep
            Object.keys(gauges).forEach(function (k) { gauges[k].snap(eased); });
            requestAnimationFrame(sweep);
        }
        requestAnimationFrame(sweep);
        setTimeout(function () {
            document.querySelectorAll(".scramble").forEach(scramble);
        }, 300);
    }

    /* ============ main loop ============ */

    var lastT = performance.now();
    var frameCount = 0;
    function loop(now) {
        var dt = Math.max(1, now - lastT) / 1000; // seconds
        lastT = now;
        frameCount++;

        // instantaneous velocities
        var scrollNow = window.scrollY;
        state.scrollVelRaw = Math.abs(scrollNow - state.lastScrollY) / dt;
        state.lastScrollY = scrollNow;

        state.cursorVelRaw = (state._pendingCursor || 0) / dt;
        state._pendingCursor = 0;

        // smoothing
        state.scrollVel = lerp(state.scrollVel, state.scrollVelRaw, 0.12);
        state.cursorVel = lerp(state.cursorVel, state.cursorVelRaw, 0.12);
        state.activity = Math.max(0, state.activity * Math.pow(0.02, dt)); // fast decay
        var rpm = clamp(state.activity * 90, 0, 8400);

        if (state.ignition) {
            gauges.scroll.set(state.scrollVel / gaugeDefs.scroll.max);
            gauges.cursor.set(state.cursorVel / gaugeDefs.cursor.max);
            gauges.activity.set(rpm / gaugeDefs.activity.max);

            // digital readouts at ~10 Hz to stay readable
            if (frameCount % 6 === 0) {
                outs.scroll.textContent = Math.round(state.scrollVel);
                outs.cursor.textContent = Math.round(state.cursorVel);
                outs.activity.textContent = Math.round(rpm);
                if (velOut) velOut.textContent = Math.round(Math.max(state.scrollVel, state.cursorVel));
                updateOdometer();
            }
            if (lapOut && state.lapStart !== null && frameCount % 3 === 0) {
                lapOut.textContent = formatLap(now - state.lapStart);
            }

            // waveform history
            waveA.push(clamp(state.cursorVel / 4000, 0, 1));
            waveB.push(clamp(state.scrollVel / 4000, 0, 1));
            while (waveA.length > waveLen) waveA.shift();
            while (waveB.length > waveLen) waveB.shift();
            drawWave();
        }

        updateTrackDot();
        requestAnimationFrame(loop);
    }

    /* ============ boot ============ */

    window.addEventListener("resize", function () { sizeWave(); placeMarkers(); });
    sizeWave();
    // markers need final layout; fonts shift heights, so re-place after load
    window.addEventListener("load", function () { placeMarkers(); updateTrackDot(); });
    placeMarkers();

    ignition();
    if (!reducedMotion) {
        requestAnimationFrame(loop);
    } else {
        // static but honest: show readouts updating at 2 Hz without needle animation
        state.ignition = true;
        setInterval(function () {
            outs.scroll.textContent = Math.round(state.scrollVel);
            outs.cursor.textContent = Math.round(state.cursorVel);
            updateOdometer();
            updateTrackDot();
            if (lapOut && state.lapStart !== null) lapOut.textContent = formatLap(performance.now() - state.lapStart);
        }, 500);
    }
})();
