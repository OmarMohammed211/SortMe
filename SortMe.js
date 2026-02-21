const $ = (sel) => document.querySelector(sel);

const barsEl = $("#bars");
const algoEl = $("#algo");
const sizeEl = $("#size");
const speedEl = $("#speed");
const sizeVal = $("#sizeVal");
const speedVal = $("#speedVal");

const btnGen = $("#gen");
const btnStart = $("#start");
const btnPause = $("#pause");
const btnStep = $("#step");
const btnReset = $("#reset");

const cmpEl = $("#cmp");
const swpEl = $("#swp");
const evEl = $("#ev");
const statusEl = $("#status");

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Speed slider (1..100) => delay ms (fast when high)
function delayFromSpeed(s) {
    // 1 -> 140ms, 100 -> 4ms
    const ms = Math.round(140 - (s * 1.36));
    return Math.max(4, ms);
}

function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

// ---------- Visual State ----------
let arr = [];
let originalArr = [];
let events = [];
let eventIndex = 0;

let comparisons = 0;
let writes = 0;

let running = false;
let paused = false;
let done = false;

function setStatus(text) { statusEl.textContent = text; }

function resetStats() {
    comparisons = 0;
    writes = 0;
    cmpEl.textContent = "0";
    swpEl.textContent = "0";
}

function renderBars(highlights = {}) {
    // highlights: { compare:[i,j], swap:[i,j], sorted:Set, pivot:i }
    barsEl.innerHTML = "";
    const maxVal = Math.max(...arr, 1);

    for (let i = 0; i < arr.length; i++) {
        const bar = document.createElement("div");
        bar.className = "bar";
        const h = (arr[i] / maxVal) * 100;
        bar.style.height = h + "%";

        // Apply classes
        if (highlights.sorted && highlights.sorted.has(i)) bar.classList.add("sorted");
        if (typeof highlights.pivot === "number" && highlights.pivot === i) bar.classList.add("pivot");
        if (highlights.compare && highlights.compare.includes(i)) bar.classList.add("compare");
        if (highlights.swap && highlights.swap.includes(i)) bar.classList.add("swap");

        barsEl.appendChild(bar);
    }
}

function clearHighlights() {
    renderBars({ sorted: new Set() });
}

// ---------- Events ----------
// Event shapes:
// { type:'compare', i, j }
// { type:'swap', i, j }
// { type:'write', i, value }
// { type:'pivot', i } // for quick
// { type:'markSorted', i } or { type:'markRangeSorted', l, r }
// { type:'done' }

const sortedSet = new Set();

function applyEvent(ev) {
    // returns highlights to render
    let highlights = { sorted: sortedSet };

    if (ev.type === "compare") {
        comparisons++;
        cmpEl.textContent = String(comparisons);
        highlights.compare = [ev.i, ev.j];
    }

    if (ev.type === "swap") {
        writes++;
        swpEl.textContent = String(writes);
        const tmp = arr[ev.i];
        arr[ev.i] = arr[ev.j];
        arr[ev.j] = tmp;
        highlights.swap = [ev.i, ev.j];
    }

    if (ev.type === "write") {
        writes++;
        swpEl.textContent = String(writes);
        arr[ev.i] = ev.value;
        highlights.swap = [ev.i];
    }

    if (ev.type === "pivot") {
        highlights.pivot = ev.i;
    }

    if (ev.type === "markSorted") {
        sortedSet.add(ev.i);
    }

    if (ev.type === "markRangeSorted") {
        for (let k = ev.l; k <= ev.r; k++) sortedSet.add(k);
    }

    if (ev.type === "done") {
        for (let k = 0; k < arr.length; k++) sortedSet.add(k);
    }

    evEl.textContent = `${eventIndex}/${events.length}`;
    return highlights;
}

// ---------- Sorting Algorithms -> events ----------
function bubbleEvents(input) {
    const a = input.slice();
    const evs = [];
    const n = a.length;
    for (let i = 0; i < n - 1; i++) {
        let swapped = false;
        for (let j = 0; j < n - 1 - i; j++) {
            evs.push({ type: "compare", i: j, j: j + 1 });
            if (a[j] > a[j + 1]) {
                [a[j], a[j + 1]] = [a[j + 1], a[j]];
                evs.push({ type: "swap", i: j, j: j + 1 });
                swapped = true;
            }
        }
        evs.push({ type: "markSorted", i: n - 1 - i });
        if (!swapped) {
            // remaining already sorted
            evs.push({ type: "markRangeSorted", l: 0, r: n - 2 - i });
            break;
        }
    }
    evs.push({ type: "done" });
    return evs;
}

function selectionEvents(input) {
    const a = input.slice();
    const evs = [];
    const n = a.length;
    for (let i = 0; i < n; i++) {
        let min = i;
        for (let j = i + 1; j < n; j++) {
            evs.push({ type: "compare", i: min, j: j });
            if (a[j] < a[min]) min = j;
        }
        if (min !== i) {
            [a[i], a[min]] = [a[min], a[i]];
            evs.push({ type: "swap", i: i, j: min });
        }
        evs.push({ type: "markSorted", i: i });
    }
    evs.push({ type: "done" });
    return evs;
}

function insertionEvents(input) {
    const a = input.slice();
    const evs = [];
    const n = a.length;
    evs.push({ type: "markSorted", i: 0 });
    for (let i = 1; i < n; i++) {
        let key = a[i];
        let j = i - 1;
        // compare downwards
        while (j >= 0) {
            evs.push({ type: "compare", i: j, j: i });
            if (a[j] > key) {
                a[j + 1] = a[j];
                evs.push({ type: "write", i: j + 1, value: a[j] });
                j--;
            } else break;
        }
        a[j + 1] = key;
        evs.push({ type: "write", i: j + 1, value: key });
        // mark prefix as sorted (visual)
        evs.push({ type: "markRangeSorted", l: 0, r: i });
    }
    evs.push({ type: "done" });
    return evs;
}

function mergeEvents(input) {
    const a = input.slice();
    const evs = [];

    function merge(l, m, r) {
        const left = a.slice(l, m + 1);
        const right = a.slice(m + 1, r + 1);
        let i = 0, j = 0, k = l;

        while (i < left.length && j < right.length) {
            evs.push({ type: "compare", i: l + i, j: (m + 1) + j });
            if (left[i] <= right[j]) {
                a[k] = left[i];
                evs.push({ type: "write", i: k, value: left[i] });
                i++;
            } else {
                a[k] = right[j];
                evs.push({ type: "write", i: k, value: right[j] });
                j++;
            }
            k++;
        }
        while (i < left.length) {
            a[k] = left[i];
            evs.push({ type: "write", i: k, value: left[i] });
            i++; k++;
        }
        while (j < right.length) {
            a[k] = right[j];
            evs.push({ type: "write", i: k, value: right[j] });
            j++; k++;
        }
    }

    function sort(l, r) {
        if (l >= r) return;
        const m = Math.floor((l + r) / 2);
        sort(l, m);
        sort(m + 1, r);
        merge(l, m, r);
        // after merge, that segment is sorted
        evs.push({ type: "markRangeSorted", l: l, r: r });
    }

    sort(0, a.length - 1);
    evs.push({ type: "done" });
    return evs;
}

function quickEvents(input) {
    const a = input.slice();
    const evs = [];

    function partition(l, r) {
        const pivot = a[r];
        evs.push({ type: "pivot", i: r });
        let i = l - 1;

        for (let j = l; j < r; j++) {
            evs.push({ type: "compare", i: j, j: r });
            if (a[j] < pivot) {
                i++;
                if (i !== j) {
                    [a[i], a[j]] = [a[j], a[i]];
                    evs.push({ type: "swap", i: i, j: j });
                }
            }
        }
        // place pivot
        if (i + 1 !== r) {
            [a[i + 1], a[r]] = [a[r], a[i + 1]];
            evs.push({ type: "swap", i: i + 1, j: r });
        }
        evs.push({ type: "markSorted", i: i + 1 });
        return i + 1;
    }

    function sort(l, r) {
        if (l > r) return;
        if (l === r) {
            evs.push({ type: "markSorted", i: l });
            return;
        }
        const p = partition(l, r);
        sort(l, p - 1);
        sort(p + 1, r);
    }

    sort(0, a.length - 1);
    evs.push({ type: "done" });
    return evs;
}

function buildEvents() {
    const algo = algoEl.value;
    sortedSet.clear();
    resetStats();
    eventIndex = 0;

    if (algo === "bubble") events = bubbleEvents(arr);
    if (algo === "selection") events = selectionEvents(arr);
    if (algo === "insertion") events = insertionEvents(arr);
    if (algo === "merge") events = mergeEvents(arr);
    if (algo === "quick") events = quickEvents(arr);

    evEl.textContent = `0/${events.length}`;
}

// ---------- Player ----------
function setButtonsState() {
    const canInteract = !running;
    btnGen.disabled = !canInteract;
    algoEl.disabled = !canInteract;
    sizeEl.disabled = !canInteract;
    // speed allowed while running
    btnStart.disabled = running || done;
    btnStep.disabled = running || done;
    btnReset.disabled = running && !paused ? true : false; // allow reset if paused or idle
    btnPause.disabled = !running && !paused;
}

async function play() {
    if (done) return;
    running = true;
    paused = false;
    setStatus("Running");
    setButtonsState();

    while (running && !paused && eventIndex < events.length) {
        const ev = events[eventIndex];
        const highlights = applyEvent(ev);
        renderBars(highlights);

        eventIndex++;

        if (ev.type === "done") {
            done = true;
            running = false;
            setStatus("Done");
            setButtonsState();
            break;
        }

        const d = delayFromSpeed(Number(speedEl.value));
        await sleep(d);
    }

    if (!done && (paused || !running)) {
        setStatus(paused ? "Paused" : "Idle");
    }

    setButtonsState();
}

function stepOnce() {
    if (done) return;
    if (eventIndex >= events.length) return;

    const ev = events[eventIndex];
    const highlights = applyEvent(ev);
    renderBars(highlights);
    eventIndex++;

    if (ev.type === "done") {
        done = true;
        setStatus("Done");
    } else {
        setStatus("Stepping");
    }
    setButtonsState();
}

function pause() {
    if (!running && !paused) return;
    if (running) {
        paused = true;
        running = false;
        setStatus("Paused");
    } else if (paused) {
        // resume
        paused = false;
        running = false; // play() will set it
        setStatus("Running");
        play();
    }
    setButtonsState();
}

function resetAll() {
    running = false;
    paused = false;
    done = false;
    setStatus("Idle");
    arr = originalArr.slice();
    sortedSet.clear();
    resetStats();
    eventIndex = 0;
    buildEvents();
    renderBars({ sorted: sortedSet });
    setButtonsState();
}

// ---------- Generate ----------
function generate() {
    const n = Number(sizeEl.value);
    arr = Array.from({ length: n }, () => randomInt(10, 500));
    originalArr = arr.slice();
    done = false;
    running = false;
    paused = false;
    setStatus("Idle");
    sortedSet.clear();
    resetStats();
    buildEvents();
    renderBars({ sorted: sortedSet });
    setButtonsState();
}

// ---------- UI Wiring ----------
sizeEl.addEventListener("input", () => {
    sizeVal.textContent = sizeEl.value;
});

speedEl.addEventListener("input", () => {
    speedVal.textContent = speedEl.value;
});

algoEl.addEventListener("change", () => {
    if (running) return;
    buildEvents();
    eventIndex = 0;
    sortedSet.clear();
    resetStats();
    renderBars({ sorted: sortedSet });
    setStatus("Idle");
    done = false;
    setButtonsState();
});

btnGen.addEventListener("click", generate);

btnStart.addEventListener("click", () => {
    if (running || done) return;
    if (events.length === 0) buildEvents();
    play();
});

btnPause.addEventListener("click", pause);

btnStep.addEventListener("click", () => {
    if (running) return;
    stepOnce();
});

btnReset.addEventListener("click", () => {
    // allow reset when idle or paused
    if (running && !paused) return;
    resetAll();
});

// init
sizeVal.textContent = sizeEl.value;
speedVal.textContent = speedEl.value;
generate();